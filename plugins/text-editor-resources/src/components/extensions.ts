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

import { getPopupPositionElement } from '@hcengineering/ui'
import { type Editor, type Range } from '@tiptap/core'

import { type InlineCommandsOptions } from './extension/inlineCommands'
import { type InsertTarget, trackInsertTarget } from './extension/insert-target'
import type { LeftMenuOptions } from './extension/leftMenu'
import type { SuggestionKeyDownProps, SuggestionProps } from './extension/suggestion'
import InlineCommandsList from './InlineCommandsList.svelte'
import { SvelteRenderer } from './node-view'

export const mInsertTable = [
  {
    label: '2x2',
    rows: 2,
    cols: 2,
    header: false
  },
  {
    label: '3x3',
    rows: 3,
    cols: 3,
    header: false
  },
  {
    label: '2x1',
    rows: 2,
    cols: 1,
    header: false
  },
  {
    label: '5x5',
    rows: 5,
    cols: 5,
    header: false
  },
  {
    label: '1x2',
    rows: 1,
    cols: 2,
    header: false
  },
  {
    label: 'Headed 2x2',
    rows: 2,
    cols: 2,
    header: true
  },
  {
    label: 'Headed 3x3',
    rows: 3,
    cols: 3,
    header: true
  },
  {
    label: 'Headed 2x1',
    rows: 2,
    cols: 1,
    header: true
  },
  {
    label: 'Headed 5x5',
    rows: 5,
    cols: 5,
    header: true
  },
  {
    label: 'Headed 1x2',
    rows: 1,
    cols: 2,
    header: true
  }
]

/**
 * @public
 */
export function inlineCommandsConfig (items: LeftMenuOptions['items']): Partial<InlineCommandsOptions> {
  let pending: InsertTarget | undefined

  return {
    suggestion: {
      items: () => items().map(({ id, label, icon }) => ({ id, label, icon })),
      command: ({ editor, range, props }: { editor: Editor, range: Range, props: { id?: string } }) => {
        const item = items().find(({ id }) => id === props?.id)
        if (item === undefined || editor.isDestroyed || !editor.isEditable) return
        editor.commands.deleteRange(range)

        if (pending?.started === false) pending.release()
        const target = trackInsertTarget(editor, range.from, (released) => {
          if (pending === released) pending = undefined
        })
        pending = target
        const run = async (): Promise<void> => {
          try {
            const { node } = editor.view.domAtPos(range.from)
            const anchor = node instanceof HTMLElement ? getPopupPositionElement(node) : undefined
            await item.run({ editor, target, anchor })
          } catch (error) {
            target.release()
            console.error('Failed to insert editor content:', error)
          }
        }
        void run()
      },
      render: () => {
        let component: any

        return {
          onStart: (props: SuggestionProps) => {
            component = new SvelteRenderer(InlineCommandsList, {
              element: document.body,
              props: {
                ...props,
                close: () => {
                  component?.destroy()
                }
              }
            })
          },
          onUpdate (props: SuggestionProps) {
            component?.updateProps(props)
          },
          onKeyDown (props: SuggestionKeyDownProps) {
            if (props.event.key === 'Escape') {
              props.event.stopPropagation()
            }
            return component?.onKeyDown(props)
          },
          onExit () {
            component?.destroy()
          }
        }
      }
    }
  }
}
