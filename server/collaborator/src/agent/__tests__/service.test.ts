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

import { Hocuspocus } from '@hocuspocus/server'
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs'
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap'
import type { CollaborativeDoc, WorkspaceUuid, WorkspaceDataId } from '@hcengineering/core'
import { AgentService } from '../service'
import { AgentApiFailure } from '../errors'
import type { AgentActor } from '../access'

const docName = 'workspace|class|document|content'
const target: CollaborativeDoc = {
  objectClass: 'class' as CollaborativeDoc['objectClass'],
  objectId: 'document' as CollaborativeDoc['objectId'],
  objectAttr: 'content'
}
const actor: AgentActor = {
  workspace: 'workspace',
  readonly: false,
  readClientFactory: async () => {
    throw new Error('Unused read client in this fixture')
  },
  context: {
    connectionId: 'request',
    wsIds: { uuid: 'workspace' as WorkspaceUuid, dataId: 'workspace' as WorkspaceDataId, url: 'workspace' },
    clientFactory: async () => {
      throw new Error('No platform client is used in this fixture')
    }
  }
}

interface ServiceFixture {
  service: AgentService
  hocuspocus: Hocuspocus
  authorize: jest.MockedFunction<(current: AgentActor) => Promise<AgentActor['context']>>
  stored: Map<string, Uint8Array>
  authors: string[]
  changedBy: string[]
}

function fixture (): ServiceFixture {
  const stored = new Map<string, Uint8Array>()
  const authors: string[] = []
  const changedBy: string[] = []
  const hocuspocus = new Hocuspocus({
    quiet: true,
    debounce: 0,
    maxDebounce: 0,
    yDocOptions: { gc: false, gcFilter: () => false },
    onLoadDocument: async ({ documentName }) => {
      const doc = new Doc({ gc: false })
      const state = stored.get(documentName)
      if (state !== undefined) applyUpdate(doc, state)
      return doc
    },
    onChange: async ({ context }) => {
      changedBy.push(context.connectionId)
    },
    onStoreDocument: async ({ documentName, document, context }) => {
      stored.set(documentName, encodeStateAsUpdate(document))
      authors.push(context.connectionId)
    }
  })
  const authorize = jest.fn(async (current: AgentActor) => current.context)
  const service = new AgentService(hocuspocus, authorize)
  const doc = new Doc({ gc: false })
  prosemirrorToYXmlFragment(
    service.editor.awareness.schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }]
    }),
    doc.getXmlFragment('content')
  )
  stored.set(docName, encodeStateAsUpdate(doc))
  doc.destroy()
  return { service, hocuspocus, authorize, stored, authors, changedBy }
}

async function close (hocuspocus: Hocuspocus): Promise<void> {
  hocuspocus.closeConnections()
  for (const document of hocuspocus.documents.values()) await hocuspocus.unloadDocument(document)
}

it('uses the live Hocuspocus document, preserves handles after unload and closes request connections', async () => {
  const { service, hocuspocus, authorize, stored, authors, changedBy } = fixture()
  try {
    const before = stored.get(docName)
    const outline = await service.outline(actor, { document: target })
    expect(stored.get(docName)).toEqual(before)
    expect(hocuspocus.getConnectionsCount()).toBe(0)
    const ref = outline.rows[0].ref
    const result = await service.apply(actor, {
      document: target,
      ops: [{ op: 'replace_text', ref, search: 'Hello', replace: 'Agent' }]
    })
    expect(result).toMatchObject({ ok: true, results: [{ ref }] })
    const read = await service.read(actor, { document: target, ref })
    expect(read.node.content?.[0].text).toBe('Agent world')
    expect(authorize).toHaveBeenCalledWith(actor, docName, true)
    expect(authors).toContain(actor.context.connectionId)
    expect(changedBy).toEqual([actor.context.connectionId])
    expect(hocuspocus.getConnectionsCount()).toBe(0)
  } finally {
    await close(hocuspocus)
  }
})

it('does not open documents when authorization denies access or the account is readonly', async () => {
  const { service, hocuspocus, authorize } = fixture()
  try {
    authorize.mockRejectedValueOnce(new AgentApiFailure(404, 'not_found', 'Not accessible.'))
    await expect(service.outline(actor, { document: target })).rejects.toMatchObject({ code: 'not_found' })
    expect(hocuspocus.documents.size).toBe(0)
    const readonly: AgentActor = { ...actor, readonly: true }
    await expect(service.apply(readonly, { document: target, ops: [] })).rejects.toMatchObject({ status: 403 })
    expect(authorize).toHaveBeenCalledTimes(1)
  } finally {
    await close(hocuspocus)
  }
})

it('closes the direct connection after a failed read or batch and does not persist partial changes', async () => {
  const { service, hocuspocus, stored } = fixture()
  try {
    const before = stored.get(docName)
    await expect(service.read(actor, { document: target, ref: 'a.0' })).rejects.toMatchObject({
      code: 'STALE_REFERENCE'
    })
    expect(hocuspocus.getConnectionsCount()).toBe(0)
    const ref = (await service.outline(actor, { document: target })).rows[0].ref
    expect(
      await service.apply(actor, {
        document: target,
        ops: [
          { op: 'replace_text', ref, search: 'Hello', replace: 'changed' },
          { op: 'replace_text', ref, search: 'absent', replace: 'x' }
        ]
      })
    ).toMatchObject({ ok: false, error: { opIndex: 1, outcome: 'not_applied', retryable: false } })
    expect(stored.get(docName)).toEqual(before)
    expect(hocuspocus.getConnectionsCount()).toBe(0)
  } finally {
    await close(hocuspocus)
  }
})

it('edits the already-open live document without closing another connection', async () => {
  const { service, hocuspocus } = fixture()
  const human = await hocuspocus.openDirectConnection(docName, { ...actor.context, connectionId: 'human' })
  try {
    const document = human.document
    if (document === null) throw new Error('Expected a live document')
    const ref = (await service.outline(actor, { document: target })).rows[0].ref
    let updates = 0
    document.on('update', () => {
      updates++
    })
    await service.apply(actor, {
      document: target,
      ops: [{ op: 'replace_text', ref, search: 'Hello', replace: 'Agent' }]
    })
    expect(updates).toBe(1)
    expect(service.editor.read(document, docName, ref).node.content?.[0].text).toBe('Agent world')
    expect(hocuspocus.documents.get(docName)).toBe(document)
    expect(hocuspocus.getConnectionsCount()).toBe(1)
  } finally {
    await human.disconnect()
    await close(hocuspocus)
  }
})
