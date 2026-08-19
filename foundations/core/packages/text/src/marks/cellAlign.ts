//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { Extension } from '@tiptap/core'

// Picks the first non-empty value, treating '' the same as unset (CSSStyleDeclaration properties
// are always strings, never null/undefined, so a plain `||`/`??` chain would not skip an unset
// inline style the way it needs to here).
function firstNonEmpty (...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value
    }
  }
  return null
}

// Horizontal alignment of the cell content, mirrors CSS `text-align`.
export type CellTextAlign = 'left' | 'center' | 'right'

// Vertical alignment of the cell content, mirrors CSS `vertical-align`.
export type CellVerticalAlign = 'top' | 'middle' | 'bottom'

export interface CellAlignOptions {
  types: string[]
  // Block node types that can carry their own `textAlign` (set by the paragraph/heading-level
  // TextAlign extension). A block's own text-align takes CSS precedence over the cell's -
  // `setCellTextAlign` clears it on these types so the cell-level choice actually becomes visible
  // instead of silently doing nothing.
  blockTypes: string[]
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cellAlign: {
      setCellTextAlign: (align: CellTextAlign) => ReturnType
      unsetCellTextAlign: () => ReturnType
      setCellVerticalAlign: (align: CellVerticalAlign) => ReturnType
      unsetCellVerticalAlign: () => ReturnType
    }
  }
}

/**
 * Adds `textAlign`/`verticalAlign` attributes to the configured node types (typically `tableCell`)
 * and commands to set/reset them.
 *
 * The commands are implemented via `updateAttributes`/`resetAttributes`, which apply to every
 * node within the current selection range. This means they work out of the box for a `CellSelection`
 * spanning multiple table cells, not just for a single cell - selecting several cells and picking
 * an alignment applies it to all of them in one step.
 */
export const CellAlign = Extension.create<CellAlignOptions>({
  name: 'cellAlign',

  addOptions () {
    return {
      types: [],
      blockTypes: ['paragraph', 'heading']
    }
  },

  addGlobalAttributes () {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => firstNonEmpty(element.style.textAlign, element.getAttribute('data-text-align')),
            renderHTML: (attributes) => {
              if (typeof attributes.textAlign !== 'string') {
                return {}
              }

              return {
                'data-text-align': attributes.textAlign,
                style: `text-align: ${attributes.textAlign}`
              }
            }
          },
          verticalAlign: {
            default: null,
            parseHTML: (element) =>
              firstNonEmpty(element.style.verticalAlign, element.getAttribute('data-vertical-align')),
            renderHTML: (attributes) => {
              if (typeof attributes.verticalAlign !== 'string') {
                return {}
              }

              return {
                'data-vertical-align': attributes.verticalAlign,
                style: `vertical-align: ${attributes.verticalAlign}`
              }
            }
          }
        }
      }
    ]
  },

  addCommands () {
    return {
      setCellTextAlign:
        (align: CellTextAlign) =>
        ({ commands }) => {
          const updated = this.options.types
            .map((type) => commands.updateAttributes(type, { textAlign: align }))
            .every((response) => response)

          // Best-effort cleanup: a paragraph/heading with its own text-align would otherwise
          // hide the cell-level one. Not included in the returned result - the command should
          // still be considered successful even if the schema has no such block types.
          this.options.blockTypes.forEach((type) => commands.resetAttributes(type, 'textAlign'))

          return updated
        },

      unsetCellTextAlign:
        () =>
        ({ commands }) => {
          return this.options.types
            .map((type) => commands.resetAttributes(type, 'textAlign'))
            .every((response) => response)
        },

      setCellVerticalAlign:
        (align: CellVerticalAlign) =>
        ({ commands }) => {
          return this.options.types
            .map((type) => commands.updateAttributes(type, { verticalAlign: align }))
            .every((response) => response)
        },

      unsetCellVerticalAlign:
        () =>
        ({ commands }) => {
          return this.options.types
            .map((type) => commands.resetAttributes(type, 'verticalAlign'))
            .every((response) => response)
        }
    }
  }
})
