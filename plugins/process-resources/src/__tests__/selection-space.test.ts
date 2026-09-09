//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.

import core from '@hcengineering/core'
import type { Client, Doc, Ref, Space } from '@hcengineering/core'
import { createContext } from '@hcengineering/process'
import type { ContextId, ExecutionContext, Process, SelectedContext } from '@hcengineering/process'
import { resolveSelectionSpace } from '../selection-space'

const contextId = 'previous-step' as ContextId
const targetSpace = 'target-space' as Ref<Space>
const findOne = jest.fn()
const findAttribute = jest.fn()
const client = {
  findOne,
  getHierarchy: () => ({ findAttribute, isMixin: () => false })
} as unknown as Client
const definition = {
  masterTag: core.class.Doc,
  context: {
    [contextId]: {
      _class: core.class.Doc,
      name: 'Previous step',
      value: { type: 'context', id: contextId, key: '' }
    }
  }
} as unknown as Process
const doc: Doc = {
  _id: 'current-card' as Ref<Doc>,
  _class: core.class.Doc,
  space: targetSpace,
  modifiedOn: 0,
  modifiedBy: core.account.System
}

async function resolve (
  source: SelectedContext,
  value?: unknown,
  object: Doc | undefined = doc
): Promise<Ref<Space> | undefined> {
  const context: ExecutionContext = { __contextId: true, [contextId]: value }
  return await resolveSelectionSpace(client, definition, object, context, createContext(source))
}

beforeEach(() => {
  findOne.mockReset()
  findAttribute.mockReset()
})

test('preserves fixed spaces and an explicitly unrestricted selection', async () => {
  const context: ExecutionContext = { __contextId: true }
  await expect(resolveSelectionSpace(client, definition, doc, context, targetSpace)).resolves.toBe(targetSpace)
  await expect(resolveSelectionSpace(client, definition, doc, context, undefined)).resolves.toBeUndefined()
  expect(findOne).not.toHaveBeenCalled()
})

test('uses the current card space', async () => {
  await expect(resolve({ type: 'attribute', key: 'space' })).resolves.toBe(targetSpace)
})

test('uses a custom space value from the process attribute editor', async () => {
  await expect(resolve({ type: 'const', key: '', value: targetSpace })).resolves.toBe(targetSpace)
})

test.each([targetSpace, { _id: targetSpace }])('uses a space from a previous result: %p', async (value) => {
  await expect(resolve({ type: 'context', id: contextId, key: '' }, value)).resolves.toBe(targetSpace)
})

test('reads the space from an object stored in the execution context', async () => {
  await expect(resolve({ type: 'context', id: contextId, key: 'space' }, doc)).resolves.toBe(targetSpace)
  expect(findOne).not.toHaveBeenCalled()
})

test('loads an object when the context contains its reference', async () => {
  findOne.mockResolvedValue(doc)
  await expect(resolve({ type: 'context', id: contextId, key: 'space' }, 'selected-card')).resolves.toBe(targetSpace)
  expect(findOne).toHaveBeenCalledWith(core.class.Doc, { _id: 'selected-card' })
})

test('resolves imported attribute bindings', async () => {
  const context: ExecutionContext = { __contextId: true }
  await expect(
    resolveSelectionSpace(
      client,
      { ...definition, bindings: { spaceSlot: 'space' } },
      doc,
      context,
      createContext({ type: 'attribute', key: 'spaceSlot' })
    )
  ).resolves.toBe(targetSpace)
})

test.each([undefined, null, '', [], [targetSpace]])(
  'does not remove the restriction for an invalid context: %p',
  async (value) => {
    await expect(resolve({ type: 'context', id: contextId, key: '' }, value)).rejects.toThrow()
  }
)

test('does not remove the restriction when the referenced object is unavailable', async () => {
  findOne.mockResolvedValue(undefined)
  await expect(resolve({ type: 'context', id: contextId, key: 'space' }, 'missing-card')).rejects.toThrow()
})
