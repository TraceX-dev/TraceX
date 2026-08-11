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

import { type Editor } from '@tiptap/core'
import { Node, Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'

import { findCell, selectCurrentCell } from './utils'

const schema = new Schema({
  nodes: {
    doc: { content: 'table' },
    table: { content: 'tableRow+', tableRole: 'table' },
    tableRow: { content: 'tableCell+', tableRole: 'row' },
    tableCell: {
      content: 'paragraph+',
      tableRole: 'cell',
      attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } }
    },
    paragraph: { content: 'text*' },
    text: {}
  }
})

const textOnlySchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {}
  }
})

function cell (text: string): object {
  return {
    type: 'tableCell',
    attrs: { colspan: 1, rowspan: 1, colwidth: null },
    content: [
      {
        type: 'paragraph',
        content: text.length > 0 ? [{ type: 'text', text }] : []
      }
    ]
  }
}

function row (...cells: object[]): object {
  return { type: 'tableRow', content: cells }
}

function createDoc (rows: object[]): Node {
  return Node.fromJSON(schema, { type: 'doc', content: [{ type: 'table', content: rows }] })
}

function findCellPos (doc: Node, text: string): number {
  let result = -1
  doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' && node.textContent === text) {
      result = pos
      return false
    }
  })
  if (result === -1) {
    throw new Error(`cell "${text}" not found`)
  }
  return result
}

function textOnlyState (): EditorState {
  const doc = textOnlySchema.node('doc', null, [textOnlySchema.node('paragraph', null, textOnlySchema.text('hi'))])
  return EditorState.create({ doc })
}

function fakeEditor (state: EditorState, dispatch: (tr: Transaction) => void): Editor {
  return { state, view: { dispatch } } as unknown as Editor
}

describe('findCell', () => {
  it('finds the enclosing cell for a cursor position inside it', () => {
    const doc = createDoc([row(cell('A1'), cell('B1'))])
    const cursor = findCellPos(doc, 'A1') + 2 // inside the paragraph text of A1
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, cursor) })

    const cellLoc = findCell(state.selection)

    expect(cellLoc?.pos).toBe(findCellPos(doc, 'A1'))
  })

  it('returns undefined when the selection is not inside a table', () => {
    expect(findCell(textOnlyState().selection)).toBeUndefined()
  })
})

describe('selectCurrentCell', () => {
  it('expands a cursor in a single cell into a CellSelection covering that one cell', () => {
    const doc = createDoc([row(cell('A1'), cell('B1')), row(cell('A2'), cell('B2'))])
    const cursor = findCellPos(doc, 'A1') + 2
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, cursor) })

    let dispatched: Transaction | undefined
    const result = selectCurrentCell(
      fakeEditor(state, (tr) => {
        dispatched = tr
      })
    )

    expect(result).toBe(true)
    const selection = dispatched?.selection
    expect(selection).toBeInstanceOf(CellSelection)
    const cellSelection = selection as CellSelection
    // Anchor and head are the same cell - the whole (single) cell is now selected, not a range.
    expect(cellSelection.$anchorCell.pos).toBe(cellSelection.$headCell.pos)
    expect(cellSelection.$anchorCell.pos).toBe(findCellPos(doc, 'A1'))
  })

  it('does nothing when a CellSelection is already active (explicit multi-cell selection)', () => {
    const doc = createDoc([row(cell('A1'), cell('B1'))])
    const selection = CellSelection.create(doc, findCellPos(doc, 'A1'), findCellPos(doc, 'B1'))
    const state = EditorState.create({ doc, selection })
    const dispatch = jest.fn()

    const result = selectCurrentCell(fakeEditor(state, dispatch))

    expect(result).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does nothing outside a table', () => {
    const dispatch = jest.fn()

    const result = selectCurrentCell(fakeEditor(textOnlyState(), dispatch))

    expect(result).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
