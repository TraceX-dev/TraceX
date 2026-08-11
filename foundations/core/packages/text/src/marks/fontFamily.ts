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
 * `setFontFamily` is a plain `setMark` call, same as `TextColor.setTextColor`. That is enough to
 * also work across a multi-cell `CellSelection` (selecting several table cells at once and picking
 * a font applies it to all of them): `prosemirror-tables` builds a `CellSelection` with one
 * `SelectionRange` per selected cell, and tiptap's `setMark` iterates `selection.ranges` rather than
 * assuming a single contiguous text range, so no special-casing is needed here - unlike a plain
 * `TextSelection`, whose `ranges` is just `[{ $from, $to }]`.
 *
 * `unsetFontFamily` deliberately does *not* use `unsetMark('textStyle')`: `color` (from `TextColor`)
 * lives on the same `textStyle` mark, so removing the whole mark would silently drop the text color
 * too. Instead it nulls out just the `fontFamily` attribute via `setMark` (which merges with any
 * existing attributes on that mark) and cleans up the mark with `removeEmptyTextStyle` if nothing is
 * left set on it.
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
              const fontFamily = element.style.fontFamily
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
            return chain().setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run()
          }
    }
  }
})
