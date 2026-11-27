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

import type { Blob as StoredBlob, Ref } from '@hcengineering/core'
import { Editor, Node } from '@tiptap/core'
import { Collaboration } from '@tiptap/extension-collaboration'
import { TableKit } from '@tiptap/extension-table'
import { StarterKit } from '@tiptap/starter-kit'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { pickAndInsertImages } from '../../editor/insert-images'
import { insertInlineImages } from '../inline-image-insertion'
import { trackInsertTarget, trackSelectionTarget } from '../insert-target'
import type { FileAttachFunction } from '../types'

jest.mock('@hcengineering/presentation', () => ({
  getImageSize: async () => ({ width: 10, pixelRatio: 1 }),
  imageSizeToRatio: (width: number) => width
}))

const Image = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ 'file-id': { default: null }, width: { default: null }, display: { default: null } }),
  renderHTML: ({ HTMLAttributes }) => ['img', HTMLAttributes]
})

function createEditor (doc?: Y.Doc): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ undoRedo: doc === undefined ? {} : false }),
      TableKit,
      Image,
      ...(doc === undefined ? [] : [Collaboration.configure({ document: doc })])
    ],
    content: doc === undefined ? '<p>above</p><p>target</p><p>below</p>' : undefined
  })
}

function blockStart (editor: Editor, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize
  return pos
}

function imageIds (editor: Editor): string[] {
  const ids: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') ids.push(node.attrs['file-id'])
  })
  return ids
}

function attached (file: File): Awaited<ReturnType<FileAttachFunction>> {
  return { file: file.name as Ref<StoredBlob>, type: file.type }
}

function deferred<T> (): { promise: Promise<T>, finish: (value: T) => void } {
  let finish!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    finish = resolve
  })
  return { promise, finish }
}

describe('insertion target', () => {
  let editor: Editor
  beforeEach(() => {
    editor = createEditor()
  })
  afterEach(() => {
    editor.destroy()
    jest.restoreAllMocks()
  })

  it('inserts the table before the same block after the document changes while choosing its size', () => {
    const target = trackInsertTarget(editor, blockStart(editor, 1))
    editor.commands.insertContentAt(0, '<p>new</p>')
    expect(target.insert((chain) => chain.insertTable({ rows: 2, cols: 2 }))).toBe(true)
    expect(editor.state.doc.child(2).type.name).toBe('table')
    expect(editor.state.doc.child(3).textContent).toBe('target')
    expect(target.pos).toBeNull()
    expect(target.insert((chain) => chain.setHorizontalRule())).toBe(false)
  })

  it('stops the whole insertion when the target was deleted and does not revive on undo', () => {
    const target = trackInsertTarget(editor, blockStart(editor, 1))
    editor.commands.deleteRange({ from: blockStart(editor, 1), to: blockStart(editor, 2) })
    expect(target.pos).toBeNull()
    editor.commands.undo()
    const before = editor.getJSON()
    expect(target.insert((chain) => chain.setHorizontalRule())).toBe(false)
    expect(editor.getJSON()).toEqual(before)
  })

  it('inserts images in order after an edit above the target during the second upload', async () => {
    const target = trackInsertTarget(editor, blockStart(editor, 1))
    const files = ['1', '2', '3'].map((name) => new File([], name, { type: 'image/png' }))
    const started = deferred<undefined>()
    const pending = deferred<Awaited<ReturnType<FileAttachFunction>>>()
    const upload: FileAttachFunction = async (file) => {
      if (file.name !== '2') return attached(file)
      started.finish(undefined)
      return await pending.promise
    }
    const insertion = insertInlineImages(files, upload, target)
    await started.promise
    expect(target.started).toBe(true)
    editor.commands.insertContentAt(0, '<p>new</p>')
    pending.finish(attached(files[1]))
    await insertion
    expect(imageIds(editor)).toEqual(['1', '2', '3'])
    expect(editor.state.doc.child(2).firstChild?.attrs['file-id']).toBe('1')
    expect(editor.state.doc.child(2).textContent).toBe('target')
  })

  it('replaces the saved toolbar selection and inserts the rest of the batch in order', async () => {
    const from = blockStart(editor, 1)
    editor.commands.setTextSelection({ from: from + 2, to: from + 4 })
    const target = trackSelectionTarget(editor)
    editor.commands.insertContentAt(0, '<p>new</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)

    const files = ['1', '2'].map((name) => new File([], name, { type: 'image/png' }))
    await insertInlineImages(files, async (file) => attached(file), target)

    const paragraph = editor.state.doc.child(2)
    expect(paragraph.textContent).toBe('tget')
    expect(paragraph.child(1).attrs['file-id']).toBe('1')
    expect(paragraph.child(2).attrs['file-id']).toBe('2')
  })

  it('removes the transient file input when the native picker is cancelled', async () => {
    jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const target = trackSelectionTarget(editor)
    const upload = jest.fn(async (file: File) => attached(file))
    const insertion = pickAndInsertImages(editor, target, () => upload)
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    expect(input).not.toBeNull()
    input?.dispatchEvent(new Event('cancel'))
    await insertion
    expect(input?.isConnected).toBe(false)
    expect(target.pos).toBeNull()
    expect(upload).not.toHaveBeenCalled()
  })

  it('settles and cleans up the dialog when the target block is deleted first', async () => {
    jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const target = trackInsertTarget(editor, blockStart(editor, 1))
    const upload = jest.fn(async (file: File) => attached(file))
    const insertion = pickAndInsertImages(editor, target, () => upload)
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    expect(input).not.toBeNull()
    editor.commands.deleteRange({ from: blockStart(editor, 1), to: blockStart(editor, 2) })
    await insertion
    expect(input?.isConnected).toBe(false)
    expect(upload).not.toHaveBeenCalled()
  })

  it('uses the current attachment handler after the file selection and removes the input before upload', async () => {
    jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const target = trackInsertTarget(editor, blockStart(editor, 1))
    const original = jest.fn(async (file: File) => attached(file))
    const latest = jest.fn(async (file: File) => {
      expect(document.querySelector('input[type=file]')).toBeNull()
      return attached(file)
    })
    let upload = original
    const insertion = pickAndInsertImages(editor, target, () => upload)
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    if (input === null) throw new Error('File picker was not mounted')
    upload = latest
    Object.defineProperty(input, 'files', { value: [new File([], 'new', { type: 'image/png' })] })
    input.dispatchEvent(new Event('change'))
    await insertion
    expect(original).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
    expect(imageIds(editor)).toEqual(['new'])
    expect(target.pos).toBeNull()
  })

  it('stops pending image insertion and skips later files after the block is deleted', async () => {
    const target = trackInsertTarget(editor, blockStart(editor, 1))
    const files = ['1', '2', '3'].map((name) => new File([], name, { type: 'image/png' }))
    const pending = deferred<Awaited<ReturnType<FileAttachFunction>>>()
    const upload = jest.fn(async (_file: File) => await pending.promise)
    const insertion = insertInlineImages(files, upload, target)
    editor.commands.deleteRange({ from: blockStart(editor, 1), to: blockStart(editor, 2) })
    pending.finish(attached(files[0]))
    await insertion
    expect(upload).toHaveBeenCalledTimes(1)
    expect(imageIds(editor)).toEqual([])
  })

  it.each(['horizontalRule', 'table'])('creates a single image paragraph before a %s', async (nodeType) => {
    const pos = blockStart(editor, 1)
    editor.commands.setTextSelection(pos + 1)
    if (nodeType === 'table') editor.commands.insertTable({ rows: 1, cols: 1 })
    else editor.commands.setHorizontalRule()
    const from = blockStart(editor, 1)
    expect(editor.state.doc.nodeAt(from)?.type.name).toBe(nodeType)
    const target = trackInsertTarget(editor, from)
    const files = ['1', '2'].map((name) => new File([], name, { type: 'image/png' }))
    await insertInlineImages(files, async (file) => attached(file), target)
    expect(editor.state.doc.child(1).childCount).toBe(2)
    expect(imageIds(editor)).toEqual(['1', '2'])
    expect(editor.state.doc.child(2).type.name).toBe(nodeType)
  })

  it('releases once and detaches from the editor', () => {
    const off = jest.spyOn(editor, 'off')
    const target = trackInsertTarget(editor, 0)
    target.release()
    target.release()
    expect(target.pos).toBeNull()
    expect(off.mock.calls.filter(([event]) => event === 'transaction')).toHaveLength(1)
  })
})

describe('collaborative insertion target', () => {
  let localDoc: Y.Doc
  let remoteDoc: Y.Doc
  let editor: Editor
  let remote: Editor

  beforeEach(() => {
    localDoc = new Y.Doc()
    remoteDoc = new Y.Doc()
    localDoc.on('update', (update: Uint8Array) => {
      Y.applyUpdate(remoteDoc, update)
    })
    remoteDoc.on('update', (update: Uint8Array) => {
      Y.applyUpdate(localDoc, update)
    })
    editor = createEditor(localDoc)
    remote = createEditor(remoteDoc)
    remote.commands.setContent('<p>above</p><p>target</p><p>below</p>')
  })

  afterEach(() => {
    editor.destroy()
    remote.destroy()
    localDoc.destroy()
    remoteDoc.destroy()
  })

  it('follows ordinary remote edits above, inside, below and at the block boundary', () => {
    const target = trackInsertTarget(editor, blockStart(editor, 1))
    remote.commands.insertContentAt(2, 'X')
    remote.commands.insertContentAt(blockStart(remote, 1) + 2, 'Y')
    remote.commands.insertContentAt(blockStart(remote, 2) + 2, 'Z')
    expect(target.pos).toBe(blockStart(editor, 1))
    expect(editor.state.doc.nodeAt(target.pos!)?.textContent).toBe('tYarget')
    remote.commands.insertContentAt(blockStart(remote, 1), '<p>new</p>')
    expect(target.pos).toBe(blockStart(editor, 2))
    remote.commands.deleteRange({ from: blockStart(remote, 1), to: blockStart(remote, 2) })
    expect(target.pos).toBe(blockStart(editor, 1))
    remote.commands.deleteRange({ from: blockStart(remote, 1), to: blockStart(remote, 2) })
    expect(target.pos).toBeNull()
    expect(editor.state.doc.child(1).textContent).toBe('bZelow')
  })

  it('survives a full-document sync replacement while the shared block still exists', () => {
    const target = trackInsertTarget(editor, blockStart(editor, 1))
    const { doc } = editor.state
    // Exercise the full-document step used when the sync binding cannot fit a partial replacement.
    editor.view.dispatch(
      editor.state.tr.replaceWith(0, doc.content.size, doc.content).setMeta(ySyncPluginKey, { isChangeOrigin: true })
    )
    expect(target.pos).toBe(blockStart(editor, 1))
    remote.commands.setContent('<p>unrelated</p>')
    expect(target.pos).toBeNull()
  })

  it('keeps a batch cursor inside the shared block through a remote edit during upload', async () => {
    const target = trackInsertTarget(editor, blockStart(editor, 1))
    const files = ['1', '2', '3'].map((name) => new File([], name, { type: 'image/png' }))
    await insertInlineImages(
      files,
      async (file) => {
        if (file.name === '2') remote.commands.insertContentAt(blockStart(remote, 1) + 3, '!')
        return attached(file)
      },
      target
    )
    expect(imageIds(editor)).toEqual(['1', '2', '3'])
    expect(editor.state.doc.child(1).textContent).toBe('t!arget')
  })
})
