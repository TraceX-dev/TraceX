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

import { getEmbeddedLabel, type Asset, type IntlString } from '@hcengineering/platform'
import textEditor from '@hcengineering/text-editor'
import { getEventPositionElement, SelectPopup, showPopup } from '@hcengineering/ui'
import { type Editor } from '@tiptap/core'
import { openTextColorOptions } from '../../colors'
import { selectCurrentCell } from '../utils'

interface AlignOption {
  id: string
  icon: Asset
  label: IntlString
  action: () => boolean | undefined
}

interface FormattingOption {
  id: string
  icon: Asset
  label: IntlString
  action: () => void
}

async function showAlignPopup (event: MouseEvent, ops: AlignOption[]): Promise<void> {
  await new Promise<void>((resolve) => {
    showPopup(
      SelectPopup,
      {
        value: ops
      },
      getEventPositionElement(event),
      (val) => {
        if (val !== undefined) {
          const op = ops.find((it) => it.id === val)
          op?.action()
        }
        resolve()
      }
    )
  })
}

// Applies to every cell of the current selection (works for a single cell as well as
// a multi-cell CellSelection, see CellAlign.setCellTextAlign in @hcengineering/text).
export async function openCellTextAlignOptions (editor: Editor, event: MouseEvent): Promise<void> {
  await showAlignPopup(event, [
    {
      id: 'left',
      icon: textEditor.icon.AlignLeft,
      label: textEditor.string.AlignLeft,
      action: () => editor.commands.setCellTextAlign('left')
    },
    {
      id: 'center',
      icon: textEditor.icon.AlignCenter,
      label: textEditor.string.AlignCenter,
      action: () => editor.commands.setCellTextAlign('center')
    },
    {
      id: 'right',
      icon: textEditor.icon.AlignRight,
      label: textEditor.string.AlignRight,
      action: () => editor.commands.setCellTextAlign('right')
    },
    {
      id: 'unset',
      icon: textEditor.icon.ClearFormat,
      label: textEditor.string.Unset,
      action: () => editor.commands.unsetCellTextAlign()
    }
  ])
}

// See openCellTextAlignOptions - same multi-cell behaviour, controls CSS `vertical-align`.
export async function openCellVerticalAlignOptions (editor: Editor, event: MouseEvent): Promise<void> {
  await showAlignPopup(event, [
    {
      id: 'top',
      icon: textEditor.icon.AlignTop,
      label: textEditor.string.AlignTop,
      action: () => editor.commands.setCellVerticalAlign('top')
    },
    {
      id: 'middle',
      icon: textEditor.icon.AlignMiddle,
      label: textEditor.string.AlignMiddle,
      action: () => editor.commands.setCellVerticalAlign('middle')
    },
    {
      id: 'bottom',
      icon: textEditor.icon.AlignBottom,
      label: textEditor.string.AlignBottom,
      action: () => editor.commands.setCellVerticalAlign('bottom')
    },
    {
      id: 'unset',
      icon: textEditor.icon.ClearFormat,
      label: textEditor.string.Unset,
      action: () => editor.commands.unsetCellVerticalAlign()
    }
  ])
}

// A single table-toolbar entry that fans out into every text-formatting action, instead of one
// icon per action - the table toolbar has limited room and most of these are used far less often
// than the cell background/align actions that already have dedicated icons.
//
// Every command used here (toggleHeading/toggleBold/toggleItalic/toggleStrike/toggleUnderline/
// toggleHighlight/setTextColor) iterates `selection.ranges` under the hood (see the comment on
// TextColor.unsetTextColor in @hcengineering/text and openCellTextAlignOptions above), so picking
// an option applies it to every cell of a multi-cell CellSelection, not just one - but they still
// need a real CellSelection to begin with when the user only left a cursor in a single cell (see
// selectCurrentCell). That expansion happens here, once an option is actually picked, rather than
// eagerly when the menu is opened - doing it eagerly would move the table toolbar (its anchor
// depends on the selection kind) the instant the menu button is clicked, before the user has
// chosen anything.
function withCellSelection (editor: Editor, run: () => void): () => void {
  return () => {
    selectCurrentCell(editor)
    run()
  }
}

export async function openCellTextFormattingOptions (editor: Editor, event: MouseEvent): Promise<void> {
  const ops: FormattingOption[] = [
    {
      id: 'h1',
      icon: textEditor.icon.Header1,
      label: getEmbeddedLabel('H1'),
      action: withCellSelection(editor, () => {
        editor.commands.toggleHeading({ level: 1 })
      })
    },
    {
      id: 'h2',
      icon: textEditor.icon.Header2,
      label: getEmbeddedLabel('H2'),
      action: withCellSelection(editor, () => {
        editor.commands.toggleHeading({ level: 2 })
      })
    },
    {
      id: 'h3',
      icon: textEditor.icon.Header3,
      label: getEmbeddedLabel('H3'),
      action: withCellSelection(editor, () => {
        editor.commands.toggleHeading({ level: 3 })
      })
    },
    {
      id: 'bold',
      icon: textEditor.icon.Bold,
      label: textEditor.string.Bold,
      action: withCellSelection(editor, () => {
        editor.commands.toggleBold()
      })
    },
    {
      id: 'italic',
      icon: textEditor.icon.Italic,
      label: textEditor.string.Italic,
      action: withCellSelection(editor, () => {
        editor.commands.toggleItalic()
      })
    },
    {
      id: 'strike',
      icon: textEditor.icon.Strikethrough,
      label: textEditor.string.Strikethrough,
      action: withCellSelection(editor, () => {
        editor.commands.toggleStrike()
      })
    },
    {
      id: 'underline',
      icon: textEditor.icon.Underline,
      label: textEditor.string.Underlined,
      action: withCellSelection(editor, () => {
        editor.commands.toggleUnderline()
      })
    },
    {
      id: 'highlight',
      icon: textEditor.icon.Highlight,
      label: textEditor.string.Highlight,
      action: withCellSelection(editor, () => {
        editor.commands.toggleHighlight()
      })
    },
    {
      id: 'textColor',
      icon: textEditor.icon.TextStyle,
      label: textEditor.string.SetTextColor,
      action: withCellSelection(editor, () => {
        // Reuses the same popup as the regular text toolbar's text color button, anchored to the
        // same click event that opened this menu.
        openTextColorOptions(editor, event).catch(() => {})
      })
    }
  ]

  await new Promise<void>((resolve) => {
    showPopup(SelectPopup, { value: ops }, getEventPositionElement(event), (val) => {
      if (val !== undefined) {
        const op = ops.find((it) => it.id === val)
        op?.action()
      }
      resolve()
    })
  })
}
