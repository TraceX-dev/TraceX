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

import {
  Doc,
  XmlElement,
  XmlFragment,
  XmlText,
  UndoManager,
  applyUpdate,
  encodeStateAsUpdate,
  createRelativePositionFromTypeIndex
} from 'yjs'
import { getHandle, findByHandle, encodeHandle, decodeHandle } from '../index'
import type { Handle } from '../index'

function fixture (
  gc = false,
  client = 42
): {
  doc: Doc
  fragment: XmlFragment
  first: XmlElement
  second: XmlElement
} {
  const doc = new Doc({ gc })
  // Deterministic IDs are confined to isolated tests, before any content is created.
  doc.clientID = client
  const fragment = doc.getXmlFragment('content')
  const first = new XmlElement('paragraph')
  const second = new XmlElement('paragraph')
  fragment.push([first, second])
  return { doc, fragment, first, second }
}

describe('handles of Yjs XML elements', () => {
  it('has predictable creation clocks and resolves the exact element', () => {
    const { doc, first, second } = fixture()
    expect(getHandle(first)).toEqual({ client: 42, clock: 0 })
    expect(getHandle(second)).toEqual({ client: 42, clock: 1 })
    expect(encodeHandle(getHandle(first))).toBe('16.0')
    expect(findByHandle(doc, decodeHandle('16.0'))).toBe(first)
    expect(findByHandle(doc, decodeHandle('16.1'))).toBe(second)
    doc.destroy()
  })

  it('addresses nested elements with their own creation identity', () => {
    const { doc, first } = fixture()
    const nested = new XmlElement('paragraph')
    first.push([nested])
    expect(getHandle(nested)).toEqual({ client: 42, clock: 2 })
    expect(findByHandle(doc, getHandle(nested))).toBe(nested)
    doc.destroy()
  })

  it('keeps the handle after text/attribute edits and insertion of a sibling before it', () => {
    const { doc, fragment, first } = fixture()
    const handle = getHandle(first)
    const text = new XmlText()
    first.push([text])
    text.insert(0, 'hello')
    first.setAttribute('align', 'center')
    fragment.insert(0, [new XmlElement('paragraph')])
    text.insert(5, ' world')
    expect(getHandle(first)).toEqual(handle)
    expect(findByHandle(doc, handle)).toBe(first)
    doc.destroy()
  })

  it('does not write while building or resolving handles', () => {
    const { doc, first } = fixture()
    const before = encodeStateAsUpdate(doc)
    let updates = 0
    doc.on('update', () => {
      updates++
    })
    expect(findByHandle(doc, getHandle(first))).toBe(first)
    expect(updates).toBe(0)
    expect(encodeStateAsUpdate(doc)).toEqual(before)
    doc.destroy()
  })

  it.each([false, true])('does not redirect a deleted handle to its identical neighbor, gc=%s', (gc) => {
    const { doc, fragment, first, second } = fixture(gc)
    const handle = getHandle(first)
    fragment.delete(0, 1)
    expect(fragment.get(0)).toBe(second)
    expect(findByHandle(doc, handle)).toBeUndefined()
    expect(() => getHandle(first)).toThrow(TypeError)
    doc.destroy()
  })

  it('does not find descendants of a removed container', () => {
    const { doc, fragment, first } = fixture()
    const child = new XmlElement('paragraph')
    first.push([child])
    const handle = getHandle(child)
    fragment.delete(0, 1)
    expect(findByHandle(doc, handle)).toBeUndefined()
    doc.destroy()
  })

  it('does not find an identical replacement at the original path', () => {
    const { doc, fragment, first } = fixture()
    const handle = getHandle(first)
    fragment.delete(0, 1)
    const replacement = new XmlElement('paragraph')
    fragment.insert(0, [replacement])
    expect(findByHandle(doc, handle)).toBeUndefined()
    expect(getHandle(replacement)).not.toEqual(handle)
    doc.destroy()
  })

  it('preserves handles after binary reload into an initialized XML fragment', () => {
    const { doc, first } = fixture()
    const handle = getHandle(first)
    const copy = new Doc()
    copy.clientID = 84
    const fragment = copy.getXmlFragment('content')
    applyUpdate(copy, encodeStateAsUpdate(doc))
    const restored = fragment.get(0)
    expect(findByHandle(copy, handle)).toBe(restored)
    if (!(restored instanceof XmlElement)) throw new Error('Expected an XML element')
    expect(getHandle(restored)).toEqual(handle)
    doc.destroy()
    copy.destroy()
  })

  it('returns undefined for unknown identities and another document', () => {
    const { doc, first } = fixture()
    const other = fixture(false, 84)
    expect(findByHandle(other.doc, getHandle(first))).toBeUndefined()
    expect(findByHandle(doc, { client: 42, clock: 100 })).toBeUndefined()
    expect(findByHandle(doc, { client: 100, clock: 0 })).toBeUndefined()
    doc.destroy()
    other.doc.destroy()
  })

  it('does not resolve an XML text identity as an element', () => {
    const { doc, first } = fixture()
    const text = new XmlText()
    first.push([text])
    const relative = createRelativePositionFromTypeIndex(text, 0, -1)
    if (relative.type === null) throw new Error('Expected an integrated type identity')
    const handle: Handle = { client: relative.type.client, clock: relative.type.clock }
    expect(findByHandle(doc, handle)).toBeUndefined()
    doc.destroy()
  })

  it('does not follow a deleted handle to an undo replacement', () => {
    const { doc, fragment, first } = fixture()
    const handle = getHandle(first)
    const undo = new UndoManager(fragment)
    fragment.delete(0, 1)
    undo.undo()
    expect(fragment.length).toBe(2)
    const restored = fragment.get(0)
    if (!(restored instanceof XmlElement)) throw new Error('Expected an XML element')
    expect(getHandle(restored)).not.toEqual(handle)
    expect(findByHandle(doc, handle)).toBeUndefined()
    expect(findByHandle(doc, getHandle(restored))).toBe(restored)
    undo.destroy()
    doc.destroy()
  })

  it('rejects detached elements and closed documents', () => {
    expect(() => getHandle(new XmlElement('paragraph'))).toThrow(TypeError)
    const { doc, first } = fixture()
    const handle = getHandle(first)
    doc.destroy()
    expect(findByHandle(doc, handle)).toBeUndefined()
    expect(() => getHandle(first)).toThrow(TypeError)
  })
})
