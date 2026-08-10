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

import textEditor from '@hcengineering/text-editor'
import { getEventPositionElement, SelectPopup, showPopup } from '@hcengineering/ui'
import { type Editor } from '@tiptap/core'

interface AlignOption {
  id: string
  icon: any
  label: any
  action: () => boolean | undefined
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
