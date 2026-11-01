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

import { type AttributeSpec, Node, Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { addColumnBefore, addRowBefore } from '@tiptap/pm/tables'
import { ySyncPluginKey } from 'y-prosemirror'
import { MarkupNodeType } from '@hcengineering/text'
import { markdownToMarkup } from '@hcengineering/text-markdown'
import { tableSnapshotFromMarkup, type TableMetadata, type TableSnapshot } from '@hcengineering/view'
import { attachTableSnapshot, editorTableSnapshot, summarizeTableEdits } from './snapshot'
import { tableIdentities } from './identities'
import { buildTableDiff } from './actions/tableDiff'

jest.mock('@hcengineering/view', () => ({
  __esModule: true,
  ...jest.requireActual('../../../../../view/src/table')
}))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))

const cellAttrs: Record<string, AttributeSpec> = {
  sourceColumnId: { default: null },
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null }
}
const schema = new Schema({
  nodes: {
    doc: { content: 'table+' },
    text: {},
    paragraph: { content: 'text*' },
    table: { content: 'tableRow+', tableRole: 'table', attrs: { tableMetadata: { default: null } } },
    tableRow: { content: '(tableHeader|tableCell)+', tableRole: 'row', attrs: { sourceRowId: { default: null } } },
    tableHeader: { content: 'paragraph+', tableRole: 'header_cell', attrs: cellAttrs },
    tableCell: { content: 'paragraph+', tableRole: 'cell', attrs: cellAttrs }
  },
  marks: { link: { attrs: { href: {}, target: { default: null }, rel: { default: null } } }, bold: {} }
})

function snapshot (markdown: string, rowIds = ['a'], columnIds = ['name', 'state']): TableSnapshot {
  const table = markdownToMarkup(markdown).content?.find((node) => node.type === MarkupNodeType.table)
  if (table === undefined) throw new Error('no table')
  return tableSnapshotFromMarkup(table, rowIds, columnIds)
}

const markdown = '| Name | State |\n| --- | --- |\n| Alpha | Open |\n'
const baseline = snapshot(markdown)
const metadata: TableMetadata = {
  version: '2.0',
  cardClass: 'test:class:Doc',
  documentIds: ['a'],
  timestamp: 1,
  source: { kind: 'table', mode: 'frozen' },
  snapshot: baseline
}
function table (source = markdown, meta: TableMetadata = metadata): Node {
  return attachTableSnapshot(Node.fromJSON(schema, markdownToMarkup(source)).firstChild as Node, meta)
}
function stateWith (...tables: Node[]): EditorState {
  return EditorState.create({ schema, doc: schema.node('doc', null, tables), plugins: [tableIdentities()] })
}

describe('table snapshots', () => {
  it('reads the pasted table back without reporting local edits', () => {
    const current = editorTableSnapshot(table())
    expect(current).toEqual(baseline)
    expect(summarizeTableEdits(current, baseline, baseline)).toEqual({ localChanges: false, conflicts: false })
  })

  it('compares links, escaped pipes and formatting by content, not by Markdown', () => {
    const rich = '| Name | State |\n| --- | --- |\n| [A \\| B](https://example.com/item) | **Open** |\n'
    const current = editorTableSnapshot(table(rich, { ...metadata, snapshot: snapshot(rich) }))
    const diff = buildTableDiff(current, snapshot(rich))
    expect(diff?.rows).toHaveLength(1)
    expect(
      diff?.rows[0].cells.every(
        (cell) => cell.oldValue === cell.newValue && cell.oldHref === cell.newHref && cell.oldMarkup === undefined
      )
    ).toBe(true)
  })

  it('reports local/source conflicts on the same stable cell', () => {
    const local = snapshot(markdown.replace('Open', 'Local'))
    const fresh = snapshot(markdown.replace('Open', 'Remote'))
    expect(summarizeTableEdits(local, fresh, baseline)).toMatchObject({
      localChanges: true,
      conflicts: true,
      conflictCells: [{ rowId: 'a', columnId: 'state' }]
    })
    expect(summarizeTableEdits(local, local, baseline).conflicts).toBe(false)
    expect(summarizeTableEdits(local, baseline, baseline)).toEqual({ localChanges: true, conflicts: false })
  })

  it('reports a conflict when a locally removed row changes in the source, not when both removed it', () => {
    const removed = snapshot('| Name | State |\n| --- | --- |\n', [])
    const fresh = snapshot(markdown.replace('Open', 'Remote'))
    expect(summarizeTableEdits(removed, fresh, baseline)).toMatchObject({
      conflicts: true,
      conflictCells: [{ rowId: 'a', columnId: 'state' }]
    })
    expect(summarizeTableEdits(removed, removed, baseline)).toEqual({ localChanges: true, conflicts: false })
  })

  it('treats a renamed header edited on both sides as a conflict', () => {
    const local = snapshot(markdown.replace('State', 'Mine'))
    const fresh = snapshot(markdown.replace('State', 'Status'))
    expect(summarizeTableEdits(local, fresh, baseline).conflictCells).toEqual([{ rowId: '', columnId: 'state' }])
  })
})

describe('table identities', () => {
  it('does not give an inserted row its neighbour source identity', () => {
    let state = stateWith(table())
    const firstDataCell = 2 + (state.doc.firstChild?.firstChild?.nodeSize ?? 0) + 1
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(firstDataCell))))
    addRowBefore(state, (tr) => {
      state = state.applyTransaction(tr).state
    })
    const ids = editorTableSnapshot(state.doc.firstChild as Node).rowIds
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe('a')
    expect(ids[0]).toMatch(/^local:/)
  })

  it('keeps the original column identity when inserting before it', () => {
    let state = stateWith(table())
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(3))))
    addColumnBefore(state, (tr) => {
      state = state.applyTransaction(tr).state
    })
    const ids = editorTableSnapshot(state.doc.firstChild as Node).columnIds
    expect(ids.slice(1)).toEqual(['name', 'state'])
    expect(ids[0]).toMatch(/^local:/)
  })

  it('leaves remote collaborative changes to their author', () => {
    let state = stateWith(table())
    const duplicate = state.doc.firstChild?.child(1) as Node
    const tr = state.tr.insert(1 + (state.doc.firstChild?.content.size ?? 0), duplicate)
    tr.setMeta(ySyncPluginKey, { isChangeOrigin: true })
    state = state.applyTransaction(tr).state
    expect(editorTableSnapshot(state.doc.firstChild as Node).rowIds).toEqual(['a', 'a'])
  })

  it('only normalizes the table that was edited', () => {
    let state = stateWith(table(), table())
    // A duplicate identity arrives in the first table through sync; the local edit is in the second table.
    const duplicateRow = (state.doc.firstChild as Node).child(1)
    const firstTableEnd = 1 + (state.doc.firstChild?.content.size ?? 0)
    state = state.apply(state.tr.insert(firstTableEnd, duplicateRow).setMeta(ySyncPluginKey, {}))
    const secondTableStart = state.doc.firstChild?.nodeSize ?? 0
    state = state.applyTransaction(state.tr.insertText('x', secondTableStart + 5)).state
    expect(editorTableSnapshot(state.doc.firstChild as Node).rowIds).toEqual(['a', 'a'])
  })
})
