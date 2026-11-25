/** @jest-environment jsdom */

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

import { showPopup } from '@hcengineering/ui'
import { Editor } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import { StarterKit } from '@tiptap/starter-kit'
import { trackInsertTarget } from '../../extension/insert-target'
import { inlineCommandsConfig } from '../../extensions'
import { createInsertMenuItems } from '../editor-insertion'

jest.mock('@hcengineering/core', () => ({}))
jest.mock('@hcengineering/presentation', () => ({}))
jest.mock('@hcengineering/text-editor', () => ({ __esModule: true, default: { string: {} } }))
jest.mock('@hcengineering/view', () => ({ __esModule: true, default: { icon: {} } }))
jest.mock('@hcengineering/ui', () => ({
  SelectPopup: {},
  getPopupPositionElement: jest.fn(),
  showPopup: jest.fn()
}))
jest.mock('../../extension/toolbar/toolbar', () => ({}))
jest.mock('../../InlineCommandsList.svelte', () => ({}))
jest.mock('../../LinkPopup.svelte', () => ({}))
jest.mock('../../node-view', () => ({}))

describe('table insertion commands', () => {
  let editor: Editor
  const close = jest.fn()
  const { items } = createInsertMenuItems({ getAttachFile: () => undefined, isReadonly: () => false })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(showPopup).mockReturnValue({ id: 'size', close, update: jest.fn() })
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, TableKit],
      content: '<p>first</p><p>/table</p><p>last</p>'
    })
  })

  afterEach(() => {
    editor.destroy()
  })

  function pickTableSize (): ReturnType<typeof trackInsertTarget> {
    const item = items().find(({ id }) => id === 'table')
    if (item === undefined) throw new Error('Table command missing')
    const target = trackInsertTarget(editor, editor.state.doc.child(0).nodeSize)
    void item.run({ editor, target, anchor: undefined })
    return target
  }

  it('closes the table picker when a pending target is superseded', async () => {
    const target = pickTableSize()
    expect(target.started).toBe(false)
    target.release()
    expect(close).toHaveBeenCalledTimes(1)
    await jest.mocked(showPopup).mock.calls[0][3]?.('2x2')
    expect(editor.state.doc.child(1).textContent).toBe('/table')
  })

  it('frees the target immediately when the table picker is cancelled', async () => {
    const target = pickTableSize()
    await jest.mocked(showPopup).mock.calls[0][3]?.(undefined)
    expect(target.pos).toBeNull()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('removes the slash query and inserts at its tracked position even when the selection moved', async () => {
    const from = editor.state.doc.child(0).nodeSize + 1
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    inlineCommandsConfig(items).suggestion?.command?.({
      editor,
      range: { from, to: from + '/table'.length },
      props: { id: 'table' }
    })

    expect(editor.state.doc.child(1).textContent).toBe('')
    editor.commands.insertContentAt(0, '<p>new</p>')
    await jest.mocked(showPopup).mock.calls[0][3]?.('2x2')
    expect(editor.state.doc.child(2).type.name).toBe('table')
    expect(editor.state.doc.lastChild?.textContent).toBe('last')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
