//
// Copyright © 2023, 2024 Hardcore Engineering Inc.
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

import { SelectPopup, showPopup, type PopupAlignment } from '@hcengineering/ui'
import { type Editor, type Attribute } from '@tiptap/core'

import { type ActionContext } from '@hcengineering/text-editor'
import { hideTextEditorToolbar } from './components/extension/toolbar/toolbar'
import { mInsertTable } from './components/extensions'
import LinkPopup from './components/LinkPopup.svelte'

export function getDataAttribute (
  name: string,
  options?: Omit<Attribute, 'parseHTML' | 'renderHTML'>
): Partial<Attribute> {
  const dataName = `data-${name}`

  return {
    default: null,
    parseHTML: (element) => element.getAttribute(dataName),
    renderHTML: (attributes) => {
      if (!attributes[name]) {
        return {}
      }

      return {
        [dataName]: attributes[name]
      }
    },
    ...(options ?? {})
  }
}

interface TableSizeOptions {
  rows?: number
  cols?: number
  withHeaderRow?: boolean
}

export function openTableSizePopup (
  insertTable: (options: TableSizeOptions) => void,
  alignment?: PopupAlignment,
  cancel?: () => void
): ReturnType<typeof showPopup> {
  return showPopup(
    SelectPopup,
    { value: mInsertTable.map((it) => ({ id: it.label, text: it.label })) },
    alignment ?? 'center',
    (id) => {
      const size = mInsertTable.find((it) => it.label === id)
      if (size === undefined) {
        cancel?.()
        return
      }

      insertTable({ cols: size.cols, rows: size.rows, withHeaderRow: size.header })
    }
  )
}

export async function addTableHandler (
  insertTable: (options: TableSizeOptions) => void,
  alignment?: PopupAlignment
): Promise<void> {
  openTableSizePopup(insertTable, alignment)
}

export async function isEditable (editor: Editor): Promise<boolean> {
  return editor.isEditable
}
export async function isHeadingVisible (editor: Editor, ctx: ActionContext): Promise<boolean> {
  return (await isEditable(editor)) && ctx.mode === 'full'
}

export async function formatLink (editor: Editor): Promise<void> {
  hideTextEditorToolbar(editor)
  const link = editor.getAttributes('link').href

  // give editor some time to handle blur event
  setTimeout(() => {
    showPopup(LinkPopup, { link }, undefined, undefined, (newLink) => {
      if (newLink === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: newLink }).run()
      }
    })
  })
}
