//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

/** A request failure known to the REST layer; never instructs the client to retry a write. */
import core from '@hcengineering/core'
import type { AnyAttribute, Doc, Hierarchy, TxOperations, WorkspaceIds } from '@hcengineering/core'
import type { AgentActor } from '../access'
import { authorizeAgentDocument } from '../access'

const docName = 'workspace|class|document|content'

interface AccessFixture {
  actor: AgentActor
  values: Partial<Doc> & { content?: string, readonly?: boolean, isLatest?: boolean }
  attribute: Partial<AnyAttribute>
  hierarchy: Partial<Hierarchy>
  findAttribute: jest.MockedFunction<() => AnyAttribute | undefined>
  findOne: jest.MockedFunction<() => Promise<Doc | undefined>>
  close: jest.MockedFunction<() => Promise<void>>
  readClientFactory: jest.MockedFunction<() => Promise<TxOperations>>
  storageFactory: jest.MockedFunction<() => Promise<never>>
}

function fixture (): AccessFixture {
  const values: AccessFixture['values'] = {
    _class: 'class' as Doc['_class'],
    content: 'blob-id'
  }
  const attributeType: Partial<AnyAttribute['type']> = { _class: core.class.TypeCollaborativeDoc }
  const attribute: Partial<AnyAttribute> = { type: attributeType as AnyAttribute['type'] }
  const findAttribute = jest.fn(() => attribute as AnyAttribute | undefined)
  const hierarchy: Partial<Hierarchy> = {
    findAttribute,
    isDerived: jest.fn(() => true),
    isMixin: jest.fn(() => false)
  }
  const findOne = jest.fn(async () => values as Doc | undefined)
  const close = jest.fn(async () => {})
  const client: Partial<TxOperations> = {
    getHierarchy: () => hierarchy as Hierarchy,
    findOne: findOne as TxOperations['findOne'],
    close
  }
  const readClientFactory = jest.fn(async () => client as TxOperations)
  const storageFactory = jest.fn(async () => {
    throw new Error('Storage client must not authorize reads')
  })
  const wsIds: Partial<WorkspaceIds> = { url: 'workspace' }
  const actor: AgentActor = {
    workspace: 'workspace',
    readonly: false,
    readClientFactory,
    context: { connectionId: 'request', wsIds: wsIds as WorkspaceIds, clientFactory: storageFactory }
  }
  return { actor, values, attribute, hierarchy, findAttribute, findOne, close, readClientFactory, storageFactory }
}

it('checks visibility with the caller client and keeps the existing storage context', async () => {
  const { actor, readClientFactory, storageFactory, findOne, close } = fixture()
  const context = await authorizeAgentDocument(actor, docName, true)
  expect(readClientFactory).toHaveBeenCalledTimes(1)
  expect(storageFactory).not.toHaveBeenCalled()
  expect(findOne).toHaveBeenCalledWith('class', { _id: 'document' })
  expect(context.clientFactory).toBe(storageFactory)
  expect(context.content).toBe('blob-id')
  expect(close).toHaveBeenCalledTimes(1)
})

it('does not expose missing documents or noncollaborative fields and always closes the client', async () => {
  const { actor, findOne, findAttribute, close } = fixture()
  findOne.mockResolvedValueOnce(undefined)
  await expect(authorizeAgentDocument(actor, docName, false)).rejects.toMatchObject({ status: 404 })
  findAttribute.mockReturnValueOnce(undefined)
  await expect(authorizeAgentDocument(actor, docName, false)).rejects.toMatchObject({ code: 'invalid_document' })
  expect(close).toHaveBeenCalledTimes(2)
})

it.each(['field', 'document', 'version'])('rejects writes to a readonly %s but permits reading', async (kind) => {
  const { actor, attribute, values, close } = fixture()
  if (kind === 'field') attribute.readonly = true
  if (kind === 'document') values.readonly = true
  if (kind === 'version') values.isLatest = false
  await expect(authorizeAgentDocument(actor, docName, true)).rejects.toMatchObject({ status: 403 })
  await expect(authorizeAgentDocument(actor, docName, false)).resolves.toMatchObject({ content: 'blob-id' })
  expect(close).toHaveBeenCalledTimes(2)
})

it('rejects a readonly actor before creating a platform client', async () => {
  const { actor, readClientFactory } = fixture()
  actor.readonly = true
  await expect(authorizeAgentDocument(actor, docName, true)).rejects.toMatchObject({ status: 403 })
  expect(readClientFactory).not.toHaveBeenCalled()
})

it('rejects alternate class names and mixin addresses before opening a live document', async () => {
  const { actor, values, hierarchy, close } = fixture()
  values._class = 'other-class' as Doc['_class']
  await expect(authorizeAgentDocument(actor, docName, false)).rejects.toMatchObject({ code: 'invalid_document' })
  hierarchy.isMixin = () => true
  await expect(authorizeAgentDocument(actor, docName, false)).rejects.toMatchObject({ code: 'invalid_document' })
  expect(close).toHaveBeenCalledTimes(2)
})
