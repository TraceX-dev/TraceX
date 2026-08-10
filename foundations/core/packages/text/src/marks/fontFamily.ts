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
import '@tiptap/extension-text-style'

export interface FontFamilyOptions {
  types: string[]
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontFamily: {
      setFontFamily: (fontFamily: string) => ReturnType
      unsetFontFamily: () => ReturnType
    }
  }
}

/**
 * Adds a `fontFamily` attribute to the `textStyle` mark, with commands to set/unset it.
 *
 * `setFontFamily`/`unsetFontFamily` are plain `setMark`/`unsetMark` calls, same as `TextColor`.
 * That is enough to also work across a multi-cell `CellSelection` (selecting several table cells
 * at once and picking a font applies it to all of them): `prosemirror-tables` builds a `CellSelection`
 * with one `SelectionRange` per selected cell, and tiptap's `setMark`/`unsetMark` iterate
 * `selection.ranges` rather than assuming a single contiguous text range, so no special-casing is
 * needed here - unlike a plain `TextSelection`, whose `ranges` is just `[{ $from, $to }]`.
 */
export const FontFamily = Extension.create<FontFamilyOptions>({
  name: 'fontFamily',

  addOptions () {
    return {
      types: ['textStyle']
    }
  },

  addGlobalAttributes () {
    return [
      {
        types: this.options.types,
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element) => {
              const fontFamily = element.style.fontFamily.replace(/['"]+/g, '')
              return fontFamily !== '' ? fontFamily : null
            },
            renderHTML: (attributes) => {
              if (typeof attributes.fontFamily !== 'string') {
                return {}
              }

              return {
                'data-font-family': attributes.fontFamily,
                style: `font-family: ${attributes.fontFamily}`
              }
            }
          }
        }
      }
    ]
  },

  addCommands () {
    return {
      setFontFamily:
        (fontFamily: string) =>
          ({ chain }) => {
            return chain().setMark('textStyle', { fontFamily }).run()
          },

      unsetFontFamily:
        () =>
          ({ chain }) => {
            return chain().unsetMark('textStyle').run()
          }
    }
  }
})
