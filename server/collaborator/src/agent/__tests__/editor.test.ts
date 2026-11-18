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

import { Doc, XmlElement, applyUpdate, encodeStateAsUpdate } from 'yjs'
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap'
import { AgentEditor } from '../editor'
import type { AgentOperation, AgentOperationResult, ApplyAgentOpsResponse } from '@hcengineering/collaborator-client'

const docName = 'workspace|class|document|content'
const editor = new AgentEditor()

function create (): Doc {
  const doc = new Doc({ gc: false })
  const node = editor.awareness.schema.nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested text' }] }] },
      {
        type: 'todoList',
        content: [{ type: 'todoItem', attrs: { todoid: 'existing', userid: 'user' }, content: [{ type: 'paragraph' }] }]
      }
    ]
  })
  prosemirrorToYXmlFragment(node, doc.getXmlFragment('content'))
  return doc
}

function success (result: ApplyAgentOpsResponse): AgentOperationResult[] {
  if (!result.ok) throw new Error(result.error.message)
  return result.results
}

it('reads paginated outlines, nested matches and complete subtrees without changing Yjs', () => {
  const doc = create()
  try {
    const before = encodeStateAsUpdate(doc)
    const page = editor.outline(doc, docName, 1, 1)
    expect(page.total).toBe(3)
    expect(page.rows).toHaveLength(1)
    expect(page.typesPresent).toEqual(['blockquote', 'paragraph', 'todoItem', 'todoList'])
    expect(page.rows[0].ref).toMatch(/^[0-9a-z]+\.[0-9a-z]+$/)
    const block = editor.read(doc, docName, page.rows[0].ref)
    expect(block.children).toHaveLength(1)
    expect(block.node.content?.[0].content?.[0].text).toBe('Nested text')
    expect(editor.find(doc, docName, { type: 'paragraph', text: 'Nested' }).rows[0].ref).toBe(block.children[0].ref)
    expect(encodeStateAsUpdate(doc)).toEqual(before)
  } finally {
    doc.destroy()
  }
})

it('rejects unknown find types with nearby names but accepts known types absent from the document', () => {
  const doc = create()
  try {
    expect(() => editor.find(doc, docName, { type: 'paragraf' })).toThrow(
      /Unknown node type: paragraf\. Closest names: paragraph/
    )
    expect(() => editor.find(doc, docName, { type: '__proto__' })).toThrow(/Unknown node type/)
    expect(editor.find(doc, docName, { type: 'heading' }).rows).toEqual([])
  } finally {
    doc.destroy()
  }
})

it('explains valid content and insertion types without modifying the document', () => {
  const doc = create()
  try {
    const before = encodeStateAsUpdate(doc)
    expect(
      editor.apply(
        doc,
        docName,
        [
          {
            op: 'insert_node',
            at: { ref: 'root', where: 'end' },
            node: { type: 'table', content: [{ type: 'paragraph' }] }
          }
        ],
        {}
      )
    ).toMatchObject({
      ok: false,
      error: { code: 'SCHEMA_INVALID', message: expect.stringContaining('Expected: tableRow+') }
    })
    const paragraph = editor.outline(doc, docName).rows[0].ref
    expect(
      editor.apply(
        doc,
        docName,
        [
          {
            op: 'insert_node',
            at: { ref: paragraph, where: 'end' },
            node: { type: 'paragraph' }
          }
        ],
        {}
      )
    ).toMatchObject({
      ok: false,
      error: { code: 'POSITION_INVALID', message: expect.stringMatching(/Allowed node types:.*text.*hardBreak/) }
    })
    expect(encodeStateAsUpdate(doc)).toEqual(before)
  } finally {
    doc.destroy()
  }
})

it('applies one Yjs update and preserves handles, other shared types and protected links', () => {
  const doc = create()
  try {
    doc.getMap('other').set('value', 'keep')
    const first = editor.outline(doc, docName).rows[0]
    let updates = 0
    doc.on('update', () => {
      updates++
    })
    const result = success(
      editor.apply(
        doc,
        docName,
        [
          { op: 'replace_text', ref: first.ref, search: 'Hello', replace: 'Goodbye' },
          { op: 'add_mark', ref: first.ref, search: 'Goodbye', mark: { type: 'bold' } }
        ],
        {}
      )
    )
    expect(updates).toBe(1)
    expect(result[0]).toMatchObject({ ref: first.ref })
    expect(editor.read(doc, docName, first.ref).node.content?.[0]).toMatchObject({
      text: 'Goodbye',
      marks: [{ type: 'bold' }]
    })
    expect(doc.getMap('other').get('value')).toBe('keep')
    const todo = editor.find(doc, docName, { type: 'todoItem' }).rows[0]
    expect(
      editor.apply(doc, docName, [{ op: 'update_attrs', ref: todo.ref, attrs: { todoid: null } }], {})
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(editor.read(doc, docName, todo.ref).node.attrs?.todoid).toBe('existing')
  } finally {
    doc.destroy()
  }
})

it('leaves the live document unchanged when a later operation fails', () => {
  const doc = create()
  try {
    const first = editor.outline(doc, docName).rows[0]
    const before = encodeStateAsUpdate(doc)
    expect(
      editor.apply(
        doc,
        docName,
        [
          { op: 'replace_text', ref: first.ref, search: 'Hello', replace: 'Changed' },
          { op: 'replace_text', ref: first.ref, search: 'absent', replace: 'x' }
        ],
        {}
      )
    ).toMatchObject({
      ok: false,
      error: { opIndex: 1, code: 'TEXT_NOT_FOUND', outcome: 'not_applied', retryable: false }
    })
    expect(encodeStateAsUpdate(doc)).toEqual(before)
  } finally {
    doc.destroy()
  }
})

it('checks the complete subtree before deletion and never redirects a deleted handle', () => {
  const doc = create()
  try {
    const target = editor.outline(doc, docName).rows[1]
    success(
      editor.apply(doc, docName, [{ op: 'add_mark', ref: target.ref, search: 'Nested', mark: { type: 'bold' } }], {})
    )
    expect(
      editor.apply(doc, docName, [{ op: 'delete_node', ref: target.ref, expect: { hash: target.hash } }], {})
    ).toMatchObject({ ok: false, error: { code: 'STALE_REFERENCE' } })
    const read = editor.read(doc, docName, target.ref)
    success(editor.apply(doc, docName, [{ op: 'delete_node', ref: target.ref, expect: { hash: read.hash } }], {}))
    expect(() => editor.read(doc, docName, target.ref)).toThrow('no longer resolves')
  } finally {
    doc.destroy()
  }
})

it('preserves identity through binary reloads and merges independent peer edits', () => {
  const doc = create()
  const peer = new Doc({ gc: false })
  try {
    applyUpdate(peer, encodeStateAsUpdate(doc))
    const first = editor.outline(doc, docName).rows[0]
    const nested = editor.find(peer, docName, { type: 'paragraph', text: 'Nested' }).rows[0]
    success(editor.apply(doc, docName, [{ op: 'replace_text', ref: first.ref, search: 'Hello', replace: 'Agent' }], {}))
    success(
      editor.apply(peer, docName, [{ op: 'replace_text', ref: nested.ref, search: 'Nested', replace: 'Human' }], {})
    )
    const a = encodeStateAsUpdate(doc)
    const b = encodeStateAsUpdate(peer)
    applyUpdate(doc, b)
    applyUpdate(peer, a)
    expect(editor.outline(doc, docName)).toEqual(editor.outline(peer, docName))
    expect(editor.read(peer, docName, first.ref).node.content?.[0].text).toBe('Agent world')
    expect(editor.read(doc, docName, nested.ref).node.content?.[0].text).toBe('Human text')
  } finally {
    doc.destroy()
    peer.destroy()
  }
})

it('reads empty documents without adding a field and inserts the first content atomically', () => {
  const doc = new Doc()
  try {
    const before = encodeStateAsUpdate(doc)
    expect(editor.outline(doc, docName).rows).toEqual([])
    expect(doc.share.has('content')).toBe(false)
    expect(encodeStateAsUpdate(doc)).toEqual(before)
    const ops: AgentOperation[] = [
      { op: 'insert_node', at: { ref: 'root', where: 'end' }, node: { type: 'paragraph' } }
    ]
    const result = success(editor.apply(doc, docName, ops, {}))
    expect(result[0]).toHaveProperty('ref')
    expect(editor.outline(doc, docName).rows).toHaveLength(1)
  } finally {
    doc.destroy()
  }
})

it('preserves handles on attribute updates and returns handles for inserted nodes', () => {
  const doc = create()
  try {
    const ref = editor.find(doc, docName, { type: 'todoItem' }).rows[0].ref
    const result = success(
      editor.apply(
        doc,
        docName,
        [
          { op: 'update_attrs', ref, attrs: { checked: true } },
          {
            op: 'insert_node',
            at: { ref: 'root', where: 'end' },
            node: { type: 'paragraph', content: [{ type: 'text', text: 'New' }] }
          }
        ],
        {}
      )
    )
    expect(result[0]).toMatchObject({ ref })
    expect(editor.read(doc, docName, ref).node.attrs).toMatchObject({
      checked: true,
      todoid: 'existing',
      userid: 'user'
    })
    const inserted = result[1]
    if ('deleted' in inserted) throw new Error('Expected an inserted node')
    expect(editor.read(doc, docName, inserted.ref).node.content?.[0].text).toBe('New')
  } finally {
    doc.destroy()
  }
})

it('rejects unsupported live content without normalizing or deleting it', () => {
  const doc = new Doc()
  try {
    const unknown = new XmlElement('unknownCustomNode')
    doc.getXmlFragment('content').insert(0, [unknown])
    const before = encodeStateAsUpdate(doc)
    expect(() => editor.outline(doc, docName)).toThrow()
    expect(
      editor.apply(
        doc,
        docName,
        [
          {
            op: 'insert_node',
            at: { ref: 'root', where: 'end' },
            node: { type: 'paragraph' }
          }
        ],
        {}
      )
    ).toMatchObject({ ok: false })
    expect(encodeStateAsUpdate(doc)).toEqual(before)
  } finally {
    doc.destroy()
  }
})

it('selects only requested schema definitions without expanding dependencies', () => {
  const full = editor.schema()
  expect(Object.keys(full.nodes)).toContain('paragraph')
  expect(editor.schema({ marks: ['bold'] })).toEqual({
    topNode: full.topNode,
    nodes: {},
    marks: { bold: full.marks.bold }
  })
  expect(editor.schema({ nodes: ['paragraph'], marks: [] })).toEqual({
    topNode: full.topNode,
    nodes: { paragraph: full.nodes.paragraph },
    marks: {}
  })
  expect(editor.schema({ nodes: [] })).toEqual({ topNode: full.topNode, nodes: {}, marks: {} })
  expect(() => editor.schema({ nodes: ['unknown'] })).toThrow('Unknown node type: unknown')
  expect(() => editor.schema({ marks: ['unknown'] })).toThrow('Unknown mark type: unknown')
})

it('rejects invalid alignment values on updates and inserts without changing the document', () => {
  const doc = create()
  try {
    const ref = editor.outline(doc, docName).rows[0].ref
    success(editor.apply(doc, docName, [{ op: 'update_attrs', ref, attrs: { textAlign: 'center' } }], {}))
    expect(editor.read(doc, docName, ref).node.attrs?.textAlign).toBe('center')
    const before = encodeStateAsUpdate(doc)
    for (const textAlign of ['justify', 'invalid', 3]) {
      expect(editor.apply(doc, docName, [{ op: 'update_attrs', ref, attrs: { textAlign } }], {})).toMatchObject({
        ok: false,
        error: { code: 'SCHEMA_INVALID', outcome: 'not_applied', opIndex: 0 }
      })
      expect(
        editor.apply(
          doc,
          docName,
          [
            {
              op: 'insert_node',
              at: { ref: 'root', where: 'end' },
              node: { type: 'paragraph', attrs: { textAlign } }
            }
          ],
          {}
        )
      ).toMatchObject({ ok: false, error: { code: 'SCHEMA_INVALID' } })
    }
    expect(encodeStateAsUpdate(doc)).toEqual(before)
    success(editor.apply(doc, docName, [{ op: 'update_attrs', ref, attrs: { textAlign: null } }], {}))
    expect(editor.read(doc, docName, ref).node.attrs?.textAlign).toBeNull()
  } finally {
    doc.destroy()
  }
})

it('allows schema-defined nodes and marks without a separate type allowlist', () => {
  const doc = create()
  try {
    const paragraph = editor.outline(doc, docName).rows[0].ref
    const inserted = success(
      editor.apply(
        doc,
        docName,
        [
          {
            op: 'insert_node',
            at: { ref: paragraph, where: 'end' },
            node: { type: 'comment', content: [{ type: 'text', text: 'Inline content' }] }
          }
        ],
        {}
      )
    )[0]
    if ('deleted' in inserted) throw new Error('Expected an inserted comment node')
    const comment = editor.read(doc, docName, inserted.ref)
    expect(comment.node.type).toBe('comment')
    success(
      editor.apply(
        doc,
        docName,
        [
          {
            op: 'delete_node',
            ref: inserted.ref,
            expect: { hash: comment.hash }
          }
        ],
        {}
      )
    )
    success(
      editor.apply(
        doc,
        docName,
        [
          {
            op: 'add_mark',
            ref: paragraph,
            search: 'Hello',
            mark: { type: 'node-uuid' }
          }
        ],
        {}
      )
    )
    expect(editor.read(doc, docName, paragraph).node.content?.[0].marks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'node-uuid' })])
    )
    success(editor.apply(doc, docName, [{ op: 'remove_mark', ref: paragraph, search: 'Hello', mark: 'node-uuid' }], {}))
    expect(editor.read(doc, docName, paragraph).node.content?.[0].marks ?? []).toEqual([])
  } finally {
    doc.destroy()
  }
})
