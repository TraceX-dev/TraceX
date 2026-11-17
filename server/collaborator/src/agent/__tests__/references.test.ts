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

import { jsonToPmNode, MarkupNodeType } from '@hcengineering/text'
import { createYjsReferences, indexAgentDocument, resolveAgentTarget } from '@hcengineering/text-agent'
import type { AgentIndex, AgentReferenceSource, AgentScope } from '@hcengineering/text-agent'
import { initProseMirrorDoc, prosemirrorToYXmlFragment } from '@tiptap/y-tiptap'
import { Doc, XmlElement, applyUpdate, encodeStateAsUpdate } from 'yjs'

const scope: AgentScope = { document: 'workspace|class|document|content', field: 'content', hash: encodeURIComponent }
const fixture = jsonToPmNode({
  type: MarkupNodeType.doc,
  content: [
    { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'same' }] },
    { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'same' }] }
  ]
})

function create (gc = false, clientID?: number): Doc {
  const doc = new Doc({ gc })
  if (clientID !== undefined) doc.clientID = clientID
  prosemirrorToYXmlFragment(fixture, doc.getXmlFragment('content'))
  return doc
}

interface ReadResult extends ReturnType<typeof initProseMirrorDoc> {
  references: AgentReferenceSource
  index: AgentIndex
}

function read (doc: Doc): ReadResult {
  const fragment = doc.getXmlFragment('content')
  const initial = initProseMirrorDoc(fragment, fixture.type.schema)
  const references = createYjsReferences(doc, initial.mapping, scope)
  return { ...initial, references, index: indexAgentDocument(initial.doc, scope, references) }
}

describe('Yjs agent container handles', () => {
  it('publishes client/clock handles with a predictable creation identity', () => {
    const doc = create(false, 42)
    const current = read(doc)
    expect(current.index.entries[0].ref).toBe('16.0')
    for (const entry of current.index.entries) {
      expect(entry.ref).toMatch(/^[0-9a-z]+\.[0-9a-z]+$/)
    }
    doc.destroy()
  })

  it('does not create a missing field', () => {
    const doc = new Doc()
    const before = encodeStateAsUpdate(doc)
    const references = createYjsReferences(doc, new Map(), scope)
    expect(doc.share.has(scope.field)).toBe(false)
    expect(encodeStateAsUpdate(doc)).toEqual(before)
    expect(() => references.refForNode(fixture)).toThrow('not mapped')
    doc.destroy()
  })

  it('does not resolve a handle from another field', () => {
    const doc = create()
    const first = read(doc)
    const fragment = doc.getXmlFragment('other')
    prosemirrorToYXmlFragment(fixture, fragment)
    const initial = initProseMirrorDoc(fragment, fixture.type.schema)
    const otherScope: AgentScope = { ...scope, field: 'other' }
    const references = createYjsReferences(doc, initial.mapping, otherScope)
    const index = indexAgentDocument(initial.doc, otherScope, references)
    expect(() => resolveAgentTarget(index, first.index.entries[0].ref)).toThrow('no longer resolves')
    expect(index.entries[0].ref).not.toBe(first.index.entries[0].ref)
    doc.destroy()
  })

  it('does not write, assigns different handles to identical blocks and needs no stored UUID', () => {
    const doc = create()
    const before = encodeStateAsUpdate(doc)
    let updates = 0
    doc.on('update', () => {
      updates++
    })
    const current = read(doc)
    expect(current.index.entries[0].ref).not.toBe(current.index.entries[1].ref)
    expect(updates).toBe(0)
    expect(encodeStateAsUpdate(doc)).toEqual(before)
    doc.destroy()
  })

  it('keeps the original first block after another block is inserted at position zero', () => {
    const doc = create()
    const handle = read(doc).index.entries[0].ref
    const fragment = doc.getXmlFragment('content')
    fragment.insert(0, [new XmlElement('paragraph')])
    const current = read(doc)
    expect(current.index.entries[1].ref).toBe(handle)
    expect(current.doc.nodeAt(resolveAgentTarget(current.index, handle).from)?.textContent).toBe('same')
    expect(current.index.entries[0].ref).not.toBe(handle)
    doc.destroy()
  })

  it.each([false, true])('does not resolve a deleted container to its identical neighbor, gc=%s', (gc) => {
    const doc = create(gc)
    const handle = read(doc).index.entries[0].ref
    doc.getXmlFragment('content').delete(0, 1)
    const current = read(doc)
    expect(() => resolveAgentTarget(current.index, handle)).toThrow('no longer resolves')
    doc.destroy()
  })

  it('does not reuse a handle for identical content recreated at the same path', () => {
    const doc = create()
    const handle = read(doc).index.entries[0].ref
    const fragment = doc.getXmlFragment('content')
    fragment.delete(0, fragment.length)
    prosemirrorToYXmlFragment(fixture, fragment)
    expect(read(doc).index.entries[0].ref).not.toBe(handle)
    doc.destroy()
  })

  it('preserves handles across binary reload without a session registry', () => {
    const doc = create()
    const handle = read(doc).index.entries[0].ref
    const copy = new Doc({ gc: false })
    applyUpdate(copy, encodeStateAsUpdate(doc))
    expect(read(copy).index.entries[0].ref).toBe(handle)
    doc.destroy()
    copy.destroy()
  })

  it('changes handles when rebuilding from JSON', () => {
    const doc = create()
    const other = create()
    expect(read(other).index.entries[0].ref).not.toBe(read(doc).index.entries[0].ref)
    doc.destroy()
    other.destroy()
  })

  it('rejects another document scope, field and a non-XML root', () => {
    const doc = create()
    const current = read(doc)
    expect(() => indexAgentDocument(current.doc, { ...scope, document: 'other' }, current.references)).toThrow()
    expect(() => indexAgentDocument(current.doc, { ...scope, field: 'other' }, current.references)).toThrow()
    doc.getMap('other')
    expect(() => createYjsReferences(doc, current.mapping, { ...scope, field: 'other' })).toThrow('XML fragment')
    doc.destroy()
  })

  it('rejects a mapping that does not cover the live field', () => {
    const doc = create()
    expect(() => createYjsReferences(doc, new Map(), scope)).toThrow('mapped')
    doc.destroy()
  })
})
