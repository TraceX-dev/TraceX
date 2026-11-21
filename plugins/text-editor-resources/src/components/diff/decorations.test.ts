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

import { type AttributeSpec, type Node, Schema } from '@tiptap/pm/model'
import { ChangeSet } from '@tiptap/pm/changeset'
import { findSafeWidgetPos } from './decorations'
import { recreateTransform } from './recreate'

const cellAttrs: Record<string, AttributeSpec> = {
  sourceColumnId: { default: null },
  sourceHash: { default: null },
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null }
}

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { content: 'inline*', group: 'block' },
    table: { content: 'tableRow+', tableRole: 'table', group: 'block', attrs: { tableMetadata: { default: null } } },
    tableRow: { content: '(tableHeader|tableCell)+', tableRole: 'row', attrs: { sourceRowId: { default: null } } },
    tableHeader: { content: 'paragraph+', tableRole: 'header_cell', attrs: cellAttrs },
    tableCell: { content: 'paragraph+', tableRole: 'cell', attrs: cellAttrs }
  }
})

const p = (text: string): Node => schema.node('paragraph', null, text === '' ? [] : [schema.text(text)])
// Mirrors a table synced from a saved view: column ids live in table metadata and in cell attrs.
const table = (rows: string[][], columnIds: string[]): Node =>
  schema.node(
    'table',
    { tableMetadata: { columns: columnIds } },
    rows.map((cells, i) =>
      schema.node(
        'tableRow',
        { sourceRowId: `row-${i}` },
        cells.map((text, j) =>
          schema.node(
            i === 0 ? 'tableHeader' : 'tableCell',
            { sourceColumnId: columnIds[j], sourceHash: `${i}-${columnIds[j]}`, colwidth: [150] },
            [p(text)]
          )
        )
      )
    )
  )
const doc = (...content: Node[]): Node => schema.node('doc', null, content)

function widgetParents (from: Node, to: Node): { raw: string[], safe: string[] } {
  const tr = recreateTransform(from, to)
  const changes = ChangeSet.create(from).addSteps(tr.doc, tr.mapping.maps, undefined).changes
  return {
    raw: changes.map((c) => to.resolve(c.fromB).parent.type.name),
    safe: changes.map((c) => to.resolve(findSafeWidgetPos(to, c.fromB)).parent.type.name)
  }
}

describe('findSafeWidgetPos', () => {
  it('keeps widgets out of table rows when a column is inserted in the middle', () => {
    const before = doc(
      p('intro'),
      table(
        [
          ['Requirement', 'Approved?', 'Owner'],
          ['REQ-25', 'Yes', 'Charles'],
          ['REQ-7', 'Yes', 'Charles']
        ],
        ['req', 'approved', 'owner']
      )
    )
    const after = doc(
      p('intro'),
      table(
        [
          ['Requirement', 'Type', 'Approved?', 'Owner'],
          ['REQ-25', 'Software requirement', 'Yes', 'Charles'],
          ['REQ-7', 'Software requirement', 'Yes', 'Charles']
        ],
        ['req', 'type', 'approved', 'owner']
      )
    )
    const { raw, safe } = widgetParents(before, after)
    expect(raw.length).toBeGreaterThan(0)
    // the bug: raw positions land directly inside tableRow/table
    expect(raw.some((name) => name === 'tableRow' || name === 'table')).toBe(true)
    expect(safe.every((name) => name === 'paragraph')).toBe(true)
  })

  it('keeps widgets out of table rows when a column is removed', () => {
    const before = doc(
      table(
        [
          ['A', 'B', 'C'],
          ['1', '2', '3']
        ],
        ['a', 'b', 'c']
      )
    )
    const after = doc(
      table(
        [
          ['A', 'C'],
          ['1', '3']
        ],
        ['a', 'c']
      )
    )
    const { safe } = widgetParents(before, after)
    expect(safe.every((name) => name === 'paragraph')).toBe(true)
  })

  it('does not move positions outside of tables', () => {
    const d = doc(p('one'), p('two'))
    expect(findSafeWidgetPos(d, 5)).toBe(5)
    expect(findSafeWidgetPos(d, 2)).toBe(2)
  })
})
