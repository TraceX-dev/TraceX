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

import Code, { CodeOptions } from '@tiptap/extension-code'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { Slice } from '@tiptap/pm/model'
import codemark from 'prosemirror-codemark'

export const codeOptions: CodeOptions = {
  HTMLAttributes: {
    class: 'proseCode'
  }
}

/**
 * Note: do not forget to include css import for UI use of this extension.
 * import 'prosemirror-codemark/dist/codemark.css'
 */
export const CodeExtension = Code.extend({
  addSchemaAwareness () {
    return {
      label: 'Inline code',
      description: 'Literal inline code. Preserve the text rather than interpreting it as Markdown or editor commands.'
    }
  },

  addProseMirrorPlugins () {
    return [
      ...codemark({ markType: this.editor.schema.marks.code }),
      new Plugin({
        key: new PluginKey('code-consecutive-backticks'),
        props: {
          // Typing a character inside of two backticks will wrap the character
          // in an inline code mark.
          handleTextInput: (view: EditorView, from: number, to: number, text: string) => {
            const { state } = view

            // Prevent access out of document bounds
            if (from === 0 || to === state.doc.nodeSize - 1 || text === '`') {
              return false
            }

            if (
              from === to &&
              state.doc.textBetween(from - 1, from) === '`' &&
              state.doc.textBetween(to, to + 1) === '`'
            ) {
              const start = from - 1
              const end = to + 1
              view.dispatch(
                state.tr
                  .delete(start, end)
                  .insertText(text, start)
                  .addMark(start, start + text.length, state.schema.marks.code.create())
              )

              return true
            }

            return false
          },

          // Pasting a character inside of two backticks will wrap the character
          // in an inline code mark.
          handlePaste: (view: EditorView, _event: Event, slice: Slice) => {
            const { state } = view
            const { from, to } = state.selection

            // Prevent access out of document bounds
            if (from === 0 || to === state.doc.nodeSize - 1) {
              return false
            }

            const start = from - 1
            const end = to + 1
            if (from === to && state.doc.textBetween(start, from) === '`' && state.doc.textBetween(to, end) === '`') {
              view.dispatch(
                state.tr
                  .replaceRange(start, end, slice)
                  .addMark(start, start + slice.size, state.schema.marks.code.create())
              )
              return true
            }

            return false
          }
        }
      })
    ]
  }
})
