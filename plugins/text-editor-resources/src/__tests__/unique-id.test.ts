/** @jest-environment jsdom */

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

import { NodeIDExtension } from '@hcengineering/text'
import { Editor, getSchema, type EditorOptions, type JSONContent } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { StarterKit } from '@tiptap/starter-kit'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs'
import { EditorNodeIDExtension } from '../components/extension/unique-id'

jest.mock('@hcengineering/text', () => jest.requireActual('../../../../foundations/core/packages/text/src/unique-id'))

const content: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, uid: 'existing' }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }
  ]
}

describe('editor node identities', () => {
  const editors: Editor[] = []
  const documents: Doc[] = []

  function createEditor (options: Partial<EditorOptions> = {}): Editor {
    const editor = new Editor({
      extensions: [StarterKit.configure({ undoRedo: false }), EditorNodeIDExtension],
      content,
      ...options
    })
    editors.push(editor)
    return editor
  }

  async function created (): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  function ids (editor: Editor): unknown[] {
    const result: unknown[] = []
    editor.state.doc.descendants((node) => {
      if (!node.isText) result.push(node.attrs.uid)
    })
    return result
  }

  function syncedDocument (): Doc {
    const schema = getSchema([StarterKit, NodeIDExtension])
    const doc = prosemirrorJSONToYDoc(schema, content, 'body')
    documents.push(doc)
    return doc
  }

  function collaborativeEditor (document: Doc, editable = true): Editor {
    return createEditor({
      content: undefined,
      editable,
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        EditorNodeIDExtension,
        Collaboration.configure({ document, field: 'body' })
      ]
    })
  }

  afterEach(() => {
    editors.splice(0).forEach((editor) => {
      editor.destroy()
    })
    documents.splice(0).forEach((doc) => {
      doc.destroy()
    })
  })

  it('fills missing IDs on mount and preserves existing IDs', async () => {
    const editor = createEditor()
    await created()
    expect(ids(editor)).toEqual(['existing', expect.stringMatching(/^[0-9a-f]{16}$/)])
    expect(editor.getJSON().content?.[0].content?.[0]).not.toHaveProperty('attrs')
  })

  it('encodes all eight random bytes as hex, including leading zeros', () => {
    const bytes = new Uint8Array([0, 255, 128, 127, 1, 254, 85, 170])
    const random = jest.spyOn(crypto, 'getRandomValues').mockImplementationOnce((target) => {
      if (target === null) throw new Error('Expected a random byte buffer')
      expect(target.byteLength).toBe(8)
      new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(bytes)
      return target
    })
    try {
      const schema = getSchema([StarterKit, NodeIDExtension])
      const id: string = NodeIDExtension.options.generateID({ node: schema.nodes.paragraph.create(), pos: 0 })
      expect(id).toBe('00ff807f01fe55aa')
    } finally {
      random.mockRestore()
    }
  })

  it('does not change readonly content, including programmatic document updates', async () => {
    const editor = createEditor({ editable: false })
    const before = editor.getJSON()
    await created()
    expect(editor.getJSON()).toEqual(before)
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>Added</p>')
    expect(ids(editor)).toEqual(['existing', null, null])
  })

  it('generates IDs when readonly becomes editable and stops when switched back', async () => {
    const editor = createEditor({ editable: false })
    await created()
    editor.setEditable(true)
    const before = ids(editor)
    expect(before).toEqual(['existing', expect.any(String)])
    editor.setEditable(false)
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>Added</p>')
    expect(ids(editor)).toEqual([...before, null])
  })

  it('respects updateDocument: false even in an editable editor', async () => {
    const editor = createEditor({
      extensions: [StarterKit, EditorNodeIDExtension.configure({ updateDocument: false })]
    })
    await created()
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>Added</p>')
    expect(ids(editor)).toEqual(['existing', null, null])
  })

  it('keeps identities through split, undo and redo', async () => {
    const editor = createEditor({ extensions: [StarterKit, EditorNodeIDExtension] })
    await created()
    const before = ids(editor)
    editor.commands.setTextSelection(3)
    editor.commands.splitBlock()
    const after = ids(editor)
    expect(new Set(after).size).toBe(3)
    expect(after).toContain('existing')
    editor.commands.undo()
    expect(ids(editor)).toEqual(before)
    editor.commands.redo()
    expect(ids(editor)).toEqual(after)
  })

  it('gives copied content new identities while preserving the original', async () => {
    const editor = createEditor()
    await created()
    const before = ids(editor)
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    const event = new Event('paste')
    editor.view.pasteHTML(editor.getHTML(), event as ClipboardEvent)
    const after = ids(editor)
    expect(new Set(after).size).toBe(after.length)
    expect(after.every((id) => typeof id === 'string')).toBe(true)
    expect(after).toEqual(expect.arrayContaining(before))
  })

  it('preserves node IDs in shared JSON and HTML schemas without generating them', async () => {
    const editor = createEditor()
    await created()
    const schema = getSchema([StarterKit, NodeIDExtension])
    const restored = schema.nodeFromJSON(editor.getJSON())
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(schema).serializeFragment(restored.content))
    expect(container.querySelector('h1')?.getAttribute('data-uid')).toBe('existing')
    expect(DOMParser.fromSchema(schema).parse(container).toJSON()).toEqual(editor.getJSON())
  })

  it('mounts against pre-synced content without adding a leading empty paragraph', async () => {
    const doc = syncedDocument()
    const editor = collaborativeEditor(doc)
    await created()
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.firstChild?.type.name).toBe('heading')
    expect(ids(editor)).toEqual(['existing', expect.any(String)])
    const before = editor.getJSON()
    editor.destroy()
    const reopened = collaborativeEditor(doc)
    await created()
    expect(reopened.getJSON()).toEqual(before)
  })

  it('does not modify a pre-synced collaborative document in readonly mode', async () => {
    const doc = syncedDocument()
    const before = encodeStateAsUpdate(doc)
    const editor = collaborativeEditor(doc, false)
    await created()
    expect(ids(editor)).toEqual(['existing', null])
    expect(encodeStateAsUpdate(doc)).toEqual(before)
    editor.setEditable(true)
    expect(ids(editor)).toEqual(['existing', expect.any(String)])
  })

  it('preserves remote IDs and does not generate IDs for remote changes', async () => {
    const remote = syncedDocument()
    const local = new Doc()
    documents.push(local)
    applyUpdate(local, encodeStateAsUpdate(remote))
    const editor = collaborativeEditor(local)
    await created()
    const sender = createEditor({
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        NodeIDExtension,
        Collaboration.configure({ document: remote, field: 'body' })
      ],
      content: undefined
    })
    await created()
    sender.commands.insertContentAt(sender.state.doc.content.size, '<p>Remote</p>')
    applyUpdate(local, encodeStateAsUpdate(remote))
    expect(ids(editor).at(-1)).toBeNull()
    expect(editor.state.doc.lastChild?.textContent).toBe('Remote')
  })

  it('converges after concurrent local edits without rewriting remote identities', async () => {
    const firstDoc = syncedDocument()
    const first = collaborativeEditor(firstDoc)
    await created()
    const secondDoc = new Doc()
    documents.push(secondDoc)
    applyUpdate(secondDoc, encodeStateAsUpdate(firstDoc))
    const second = collaborativeEditor(secondDoc)
    await created()
    first.commands.insertContentAt(first.state.doc.content.size, '<p>First</p>')
    second.commands.insertContentAt(second.state.doc.content.size, '<p>Second</p>')
    const firstId = ids(first).at(-1)
    const secondId = ids(second).at(-1)
    applyUpdate(firstDoc, encodeStateAsUpdate(secondDoc))
    applyUpdate(secondDoc, encodeStateAsUpdate(firstDoc))
    expect(first.getJSON()).toEqual(second.getJSON())
    expect(ids(first)).toEqual(expect.arrayContaining([firstId, secondId]))
    expect(new Set(ids(first)).size).toBe(ids(first).length)
  })
})
