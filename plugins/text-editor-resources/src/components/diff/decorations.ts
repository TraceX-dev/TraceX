//
// Copyright © 2022 Hardcore Engineering Inc.
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

import { type MarkupNode } from '@hcengineering/text'
import { type Editor } from '@tiptap/core'
import { ChangeSet } from '@tiptap/pm/changeset'
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import { type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { deepEqual } from 'fast-equals'
import { type Doc as Ydoc } from 'yjs'
import { recreateTransform } from './recreate'

/**
 * @public
 */
export function createYdocDocument (schema: Schema, ydoc: Ydoc, field?: string): ProseMirrorNode {
  try {
    const body = yDocToProsemirrorJSON(ydoc, field)
    return schema.nodeFromJSON(body)
  } catch (err: any) {
    console.error(err)
    return schema.node(schema.topNodeType)
  }
}

const TABLE_STRUCTURE_ROLES = new Set(['table', 'row'])

/**
 * Returns a position where a widget decoration can be rendered safely.
 *
 * A widget placed directly inside a table or a table row is rendered as a DOM child of
 * `<tbody>` / `<tr>`. Browsers wrap such elements into an anonymous table cell, which
 * shifts the real cells to the right and visually splits the table (e.g. when a whole
 * column was inserted or removed). In that case we move the widget into the nearest
 * textblock of the same table: forward first, then backward, falling back to the
 * position right before the table.
 *
 * @public
 */
export function findSafeWidgetPos (doc: ProseMirrorNode, pos: number): number {
  const $pos = doc.resolve(pos)
  if (!TABLE_STRUCTURE_ROLES.has($pos.parent.type.spec.tableRole)) {
    return pos
  }

  let tableDepth = $pos.depth
  while (tableDepth > 0 && $pos.node(tableDepth).type.spec.tableRole !== 'table') {
    tableDepth--
  }
  if (tableDepth === 0) {
    return pos
  }
  const tableStart = $pos.start(tableDepth)
  const tableEnd = $pos.end(tableDepth)

  let found = -1
  doc.nodesBetween(pos, tableEnd, (node, nodePos) => {
    if (found >= 0) return false
    if (node.inlineContent) {
      found = nodePos + 1
      return false
    }
    return true
  })
  if (found >= 0) return found

  doc.nodesBetween(tableStart, pos, (node, nodePos) => {
    if (node.inlineContent) {
      found = nodePos + node.nodeSize - 1
      return false
    }
    return true
  })
  if (found >= 0) return found

  return $pos.before(tableDepth)
}

/**
 * @public
 */
export function calculateDecorations (
  editor?: Editor,
  oldContent?: MarkupNode,
  comparedDoc?: ProseMirrorNode
):
  | {
      decorations: DecorationSet
      oldContent: MarkupNode
    }
  | undefined {
  try {
    if (editor?.schema === undefined) {
      return
    }
    if (comparedDoc === undefined) {
      return
    }
    const docNew = editor.state.doc

    const c = editor.getJSON() as MarkupNode
    if (deepEqual(c, oldContent)) {
      return
    }

    const tr = recreateTransform(comparedDoc, docNew)
    const changeSet = ChangeSet.create(comparedDoc).addSteps(tr.doc, tr.mapping.maps, undefined)
    const changes = changeSet.changes

    const decorations: Decoration[] = []

    function lintIcon (color: string): any {
      const icon = document.createElement('div')
      icon.className = `text-editor-lint-icon ${color}`
      return icon
    }

    function deleted (prob: any): any {
      const icon = document.createElement('span')
      icon.className = 'text-editor-highlighted-node-delete'
      icon.innerText = prob
      return icon
    }
    changes.forEach((change) => {
      if (change.inserted.length > 0) {
        decorations.push(Decoration.inline(change.fromB, change.toB, { class: 'text-editor-highlighted-node-add' }, {}))
        decorations.push(Decoration.widget(findSafeWidgetPos(docNew, change.fromB), lintIcon('add')))
      }

      if (change.deleted.length > 0) {
        const cont = comparedDoc.textBetween(change.fromA, change.toA)
        const widgetPos = findSafeWidgetPos(docNew, change.fromB)
        decorations.push(Decoration.widget(widgetPos, deleted(cont)))
        decorations.push(Decoration.widget(widgetPos, lintIcon('delete')))
      }
    })
    if (decorations.length > 0) {
      return { decorations: DecorationSet.empty.add(docNew, decorations), oldContent: c }
    }
    return { decorations: DecorationSet.empty, oldContent: c }
  } catch (error: any) {
    console.error(error)
  }
}
