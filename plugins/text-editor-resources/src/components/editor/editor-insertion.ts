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

import { generateId } from '@hcengineering/core'
import textEditor from '@hcengineering/text-editor'
import { IconScribble } from '@hcengineering/ui'
import view from '@hcengineering/view'
import { openTableSizePopup } from '../../utils'
import { insertEditableBlock } from '../extension/insertion-selection'
import type { InsertMenuItem, LeftMenuOptions } from '../extension/leftMenu'
import type { FileAttachFunction } from '../extension/types'
import { pickAndInsertImages } from './insert-images'

interface InsertMenuConfig {
  getAttachFile: () => FileAttachFunction | undefined
  isReadonly: () => boolean
  compact?: boolean
}

export function createInsertMenuItems (config: InsertMenuConfig): {
  items: LeftMenuOptions['items']
  getAttachFile: InsertMenuConfig['getAttachFile']
} {
  const getAttachFile = (): FileAttachFunction | undefined => (config.isReadonly() ? undefined : config.getAttachFile())
  const image: InsertMenuItem = {
    id: 'image',
    label: textEditor.string.Image,
    icon: view.icon.Image,
    run: async ({ editor, target }) => {
      await pickAndInsertImages(editor, target, getAttachFile)
    }
  }
  const items: InsertMenuItem[] = [
    {
      id: 'table',
      label: textEditor.string.Table,
      icon: view.icon.Table2,
      run: ({ target, anchor }) => {
        const popup = openTableSizePopup(
          (size) => {
            target.insert((chain) => chain.insertTable(size))
          },
          anchor,
          target.release
        )
        target.onRelease(popup.close)
      }
    },
    {
      id: 'code-block',
      label: textEditor.string.CodeBlock,
      icon: view.icon.CodeBlock,
      run: ({ target }) => {
        target.insert((chain) => chain.command(insertEditableBlock({ type: 'codeBlock' })))
      }
    },
    {
      id: 'separator-line',
      label: textEditor.string.SeparatorLine,
      icon: view.icon.SeparatorLine,
      run: ({ target }) => {
        target.insert((chain) => chain.setHorizontalRule())
      }
    }
  ]

  if (config.compact !== true) {
    items.push(
      {
        id: 'todo-list',
        label: textEditor.string.TodoItem,
        icon: view.icon.TodoList,
        run: ({ target }) => {
          target.insert((chain) =>
            chain.command(
              insertEditableBlock({
                type: 'todoList',
                content: [{ type: 'todoItem', content: [{ type: 'paragraph' }] }]
              })
            )
          )
        }
      },
      {
        id: 'drawing-board',
        label: textEditor.string.DrawingBoard,
        icon: IconScribble,
        run: ({ target }) => {
          target.insert((chain) => chain.insertContent({ type: 'drawingBoard', attrs: { id: generateId() } }))
        }
      }
    )
  }

  items.push({
    id: 'mermaid',
    label: textEditor.string.MermaidDiargram,
    icon: view.icon.Model,
    run: ({ target }) => {
      target.insert((chain) => chain.command(insertEditableBlock({ type: 'mermaid' })))
    }
  })

  return {
    items: () => {
      if (config.isReadonly()) return []
      return getAttachFile() !== undefined ? [image, ...items] : items
    },
    getAttachFile
  }
}

export function insertMenuOptions (items: LeftMenuOptions['items'], className = 'tiptap-left-menu'): LeftMenuOptions {
  return {
    width: 20,
    height: 20,
    marginX: 8,
    className,
    icon: view.icon.Add,
    iconProps: { className: 'svg-tiny', fill: 'currentColor' },
    items
  }
}
