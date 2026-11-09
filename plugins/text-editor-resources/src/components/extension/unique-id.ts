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

import { NodeIDExtension } from '@hcengineering/text'
import { type Editor, findChildren } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { Plugin } from '@tiptap/pm/state'

function initializeNodeIds (editor: Editor, options: typeof NodeIDExtension.options): void {
  if (!options.updateDocument || !editor.isEditable || editor.isDestroyed) return

  const { attributeName, generateID, types } = options
  const tr = editor.state.tr
  const seen = new Set<unknown>()
  const nodes = findChildren(editor.state.doc, (node) =>
    types === 'all' ? !node.isText : types.includes(node.type.name)
  )
  for (const { node, pos } of nodes) {
    let id: unknown = node.attrs[attributeName]
    if (id == null || seen.has(id)) {
      id = generateID({ node, pos })
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attributeName]: id })
    }
    seen.add(id)
  }
  if (tr.docChanged) {
    editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta('__uniqueIDTransaction', true))
  }
}

/** Editors using collaboration must be mounted only after their provider has loaded. */
export const EditorNodeIDExtension = NodeIDExtension.extend({
  onCreate () {
    // The provider is already synced. The upstream onCreate waits for a future synced event.
    initializeNodeIds(this.editor, this.options)
  },

  onUpdate ({ transaction }) {
    // setEditable emits an update without changing the document, including readonly -> editable.
    if (!transaction.docChanged) initializeNodeIds(this.editor, this.options)
  },

  addProseMirrorPlugins () {
    const editor = this.editor
    const options = this.options
    return (this.parent?.() ?? []).map(
      (plugin) =>
        new Plugin({
          ...plugin.spec,
          appendTransaction (transactions, oldState, newState) {
            // Guard before upstream's initial Yjs normalization, which precedes filterTransaction.
            if (!editor.isEditable || transactions.some((tr) => options.filterTransaction?.(tr) === false)) return
            return plugin.spec.appendTransaction?.call(this, transactions, oldState, newState)
          }
        })
    )
  }
}).configure({
  updateDocument: true,
  filterTransaction: (transaction) => !isChangeOrigin(transaction)
})
