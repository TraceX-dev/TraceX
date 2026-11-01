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
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { Node, Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import { history, undo } from '@tiptap/pm/history'
import { MarkupNodeType } from '@hcengineering/text'
import { markdownToMarkup } from '@hcengineering/text-markdown'
import { tableSnapshotFromMarkup, type ResolvedTableSnapshot, type TableMetadata } from '@hcengineering/view'
import { applyTableRefresh } from './refreshTable'
import { attachTableSnapshot } from '../snapshot'
import { showTableMessage } from './errors'

jest.mock('./TableRefreshConfirmation.svelte', () => ({}))
jest.mock('./errors', () => ({ showTableError: jest.fn(), showTableMessage: jest.fn() }))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/view', () => ({
  __esModule: true,
  ...jest.requireActual('../../../../../../view/src/table'),
  default: { string: { TableChangedDuringPreview: 'view:string:TableChangedDuringPreview' } }
}))
jest.mock('@hcengineering/ui', () => ({ showPopup: jest.fn() }))

const cellAttrs = {
  sourceColumnId: { default: null },
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null }
}
const schema = new Schema({
  nodes: {
    doc: { content: '(paragraph|table)+' },
    text: {},
    paragraph: { content: 'text*' },
    table: { content: 'tableRow+', tableRole: 'table', attrs: { tableMetadata: { default: null } } },
    tableRow: { content: '(tableCell|tableHeader)+', tableRole: 'row', attrs: { sourceRowId: { default: null } } },
    tableCell: { content: 'paragraph+', tableRole: 'cell', attrs: cellAttrs },
    tableHeader: { content: 'paragraph+', tableRole: 'header_cell', attrs: cellAttrs }
  }
})

function resolved (markdown: string): ResolvedTableSnapshot {
  const table = markdownToMarkup(markdown).content?.find((node) => node.type === MarkupNodeType.table)
  if (table === undefined) throw new Error('no table')
  const snapshot = tableSnapshotFromMarkup(table, ['a'], ['name'])
  const metadata: TableMetadata = {
    version: '2.0',
    cardClass: 'test:class:Doc',
    documentIds: ['a'],
    timestamp: 1,
    source: { kind: 'table', mode: 'fixed' },
    snapshot
  }
  return { markdown, snapshot, metadata }
}
const old = resolved('| Name |\n| --- |\n| Old |\n')
const fresh = resolved('| Name |\n| --- |\n| New |\n')

function fixture (...extra: Node[]): { original: Node, editor: Editor, dispatch: (tr: Transaction) => void } {
  const original = attachTableSnapshot(
    Node.fromJSON(schema, markdownToMarkup(old.markdown)).firstChild as Node,
    old.metadata
  )
  let state = EditorState.create({ schema, doc: schema.node('doc', null, [original, ...extra]), plugins: [history()] })
  const dispatch = (tr: Transaction): void => {
    state = state.applyTransaction(tr).state
  }
  const editor = {
    isDestroyed: false,
    get state () {
      return state
    },
    view: { dispatch }
  } as unknown as Editor
  return { original, editor, dispatch }
}

describe('safe table refresh', () => {
  beforeEach(() => jest.clearAllMocks())

  it('re-finds a table after unrelated content is inserted before it, and can be undone', () => {
    const { editor, original, dispatch } = fixture()
    dispatch(editor.state.tr.insert(0, schema.node('paragraph', null, schema.text('Before'))))
    expect(applyTableRefresh(editor, original, 0, fresh)).toBe(true)
    expect(editor.state.doc.firstChild?.textContent).toBe('Before')
    expect(editor.state.doc.lastChild?.textContent).toContain('New')
    expect(JSON.parse(editor.state.doc.lastChild?.attrs.tableMetadata).snapshot).toEqual(fresh.snapshot)
    expect(undo(editor.state, dispatch)).toBe(true)
    expect(editor.state.doc.lastChild?.eq(original)).toBe(true)
  })

  it('replaces the identical table closest to the previewed position', () => {
    const first = fixture().original
    const { editor, original } = fixture(schema.node('paragraph', null, schema.text('gap')), first)
    const secondPos = (editor.state.doc.firstChild?.nodeSize ?? 0) + editor.state.doc.child(1).nodeSize
    expect(applyTableRefresh(editor, original, secondPos, fresh)).toBe(true)
    expect(editor.state.doc.firstChild?.textContent).toContain('Old')
    expect(editor.state.doc.lastChild?.textContent).toContain('New')
  })

  it('refuses to replace a table edited while the preview was open', () => {
    const { editor, original, dispatch } = fixture()
    dispatch(editor.state.tr.insertText('Changed', 4))
    const before = editor.state.doc
    expect(applyTableRefresh(editor, original, 0, fresh)).toBe(false)
    expect(editor.state.doc.eq(before)).toBe(true)
    expect(showTableMessage).toHaveBeenCalledWith('view:string:TableChangedDuringPreview')
  })
})
