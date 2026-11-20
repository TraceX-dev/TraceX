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

import type { Editor } from '@tiptap/core'
import { insertInlineImages } from '../extension/inline-image-insertion'
import { type InsertTarget, trackSelectionTarget } from '../extension/insert-target'
import type { FileAttachFunction } from '../extension/types'

const pendingPickers = new WeakMap<Editor, InsertTarget>()

async function pickImageFiles (document: Document, target: InsertTarget): Promise<File[]> {
  return await new Promise((resolve, reject) => {
    if (target.pos === null) {
      resolve([])
      return
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.hidden = true

    function cleanup (): void {
      input.removeEventListener('change', change)
      input.removeEventListener('cancel', cancel)
      input.remove()
    }

    function change (): void {
      const files = Array.from(input.files ?? [])
      unsubscribe()
      cleanup()
      resolve(files)
    }

    function cancel (): void {
      unsubscribe()
      cleanup()
      resolve([])
    }

    input.addEventListener('change', change)
    input.addEventListener('cancel', cancel)
    const unsubscribe = target.onRelease(() => {
      cleanup()
      resolve([])
    })

    try {
      document.body.appendChild(input)
      input.click()
    } catch (error) {
      unsubscribe()
      cleanup()
      reject(error)
    }
  })
}

export async function pickAndInsertImages (
  editor: Editor,
  target: InsertTarget,
  getAttachFile: () => FileAttachFunction | undefined
): Promise<void> {
  try {
    if (target.pos === null || getAttachFile() === undefined) return
    pendingPickers.get(editor)?.release()
    pendingPickers.set(editor, target)
    const files = await pickImageFiles(editor.view.dom.ownerDocument, target).finally(() => {
      if (pendingPickers.get(editor) === target) pendingPickers.delete(editor)
    })
    if (files.length > 0) await insertInlineImages(files, getAttachFile(), target)
  } catch (error) {
    console.error('Failed to insert image:', error)
  } finally {
    target.release()
  }
}

export function pickSelectionImages (
  editor: Editor | undefined,
  getAttachFile: () => FileAttachFunction | undefined
): void {
  if (editor === undefined || editor.isDestroyed || !editor.isEditable) return
  void pickAndInsertImages(editor, trackSelectionTarget(editor), getAttachFile)
}
