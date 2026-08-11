//
// Copyright © 2025 Hardcore Engineering Inc.
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

import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'
import { getEventPositionElement, SelectPopup, showPopup } from '@hcengineering/ui'
import { type Editor } from '@tiptap/core'
import ColorPicker from './popups/ColorPicker.svelte'
import textEditor, { type ActionContext } from '@hcengineering/text-editor'

export interface BackgroundColorOptions {
  types: string[]
}

interface ColorSpec {
  color: string
  preview?: string
}

function colorVar (tag: string, prefix = 'text'): string {
  return `var(--theme-text-editor-palette-${prefix}-${tag})`
}

function colorSpec (tag: string, prefix = 'text'): ColorSpec {
  const color = colorVar(tag, prefix)
  return { color }
}

const palette = {
  background: [
    { color: 'transparent' },
    colorSpec('gray', 'bg'),
    colorSpec('brown', 'bg'),
    colorSpec('orange', 'bg'),
    colorSpec('yellow', 'bg'),
    colorSpec('green', 'bg'),
    colorSpec('blue', 'bg'),
    colorSpec('purple', 'bg'),
    colorSpec('pink', 'bg'),
    colorSpec('red', 'bg')
  ],
  text: [
    { color: 'var(--theme-text-primary-color)' },
    colorSpec('gray'),
    colorSpec('brown'),
    colorSpec('orange'),
    colorSpec('yellow'),
    colorSpec('green'),
    colorSpec('blue'),
    colorSpec('purple'),
    colorSpec('pink'),
    colorSpec('red')
  ]
}

export async function openBackgroundColorOptions (editor: Editor, event: MouseEvent): Promise<void> {
  await new Promise<void>((resolve) => {
    showPopup(
      ColorPicker,
      { palette: palette.background, id: 'text-editor-background-color-picker' },
      getEventPositionElement(event),
      (val) => {
        const color: string | undefined = val?.color
        if (color === undefined) return

        if (color === 'transparent') {
          editor.commands.unsetBackgroundColor()
        } else {
          editor.commands.setBackgroundColor(color)
        }
        resolve()
      },
      undefined,
      {
        id: 'text-editor-background-color-picker',
        category: 'popup',
        overlay: true
      }
    )
  })
}

export async function openTextColorOptions (editor: Editor, event: MouseEvent): Promise<void> {
  await new Promise<void>((resolve) => {
    showPopup(
      ColorPicker,
      { palette: palette.text, letters: true },
      getEventPositionElement(event),
      (val) => {
        const color: string | undefined = val?.color
        if (color === undefined) return

        if (color === 'var(--theme-text-primary-color)') {
          editor.commands.unsetTextColor()
        } else {
          editor.commands.setTextColor(color)
        }
        resolve()
      },
      undefined,
      {
        id: 'text-editor-text-color-picker',
        category: 'popup',
        overlay: true
      }
    )
  })
}

interface FontOption {
  id: string
  label: IntlString
}

// Web-safe fonts that do not require loading a webfont. Font names are proper nouns and are
// intentionally not translated (getEmbeddedLabel just wraps the raw string as an IntlString).
const fontFamilies: FontOption[] = [
  { id: 'unset', label: textEditor.string.Unset },
  { id: 'Inter, sans-serif', label: getEmbeddedLabel('Inter') },
  { id: 'Arial, Helvetica, sans-serif', label: getEmbeddedLabel('Arial') },
  { id: 'Georgia, serif', label: getEmbeddedLabel('Georgia') },
  { id: '"Times New Roman", Times, serif', label: getEmbeddedLabel('Times New Roman') },
  { id: '"Courier New", Courier, monospace', label: getEmbeddedLabel('Courier New') }
]

// setFontFamily/unsetFontFamily (see @hcengineering/text FontFamily extension) are aware of a
// multi-cell CellSelection, so picking a font here applies it to every selected table cell at once.
export async function openFontFamilyOptions (editor: Editor, event: MouseEvent): Promise<void> {
  await new Promise<void>((resolve) => {
    showPopup(SelectPopup, { value: fontFamilies }, getEventPositionElement(event), (val) => {
      if (val !== undefined) {
        if (val === 'unset') {
          editor.commands.unsetFontFamily()
        } else {
          editor.commands.setFontFamily(val)
        }
      }
      resolve()
    })
  })
}

export async function isTextStylingEnabled (editor: Editor, context: ActionContext): Promise<boolean> {
  return editor.isEditable && editor.commands.setTextColor !== undefined
}
