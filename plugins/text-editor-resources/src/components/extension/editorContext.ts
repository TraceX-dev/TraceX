//
// Copyright © 2025 Hardcore Engineering Inc.
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

import { type Class, type Doc, type Ref, type Space } from '@hcengineering/core'
import { type Editor, Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface EditorContext {
  objectId?: Ref<Doc>
  objectClass?: Ref<Class<Doc>>
  objectSpace?: Ref<Space>
}

export const editorContextPluginKey = new PluginKey<EditorContext>('editor-context-plugin')

export const EditorContextExtension = Extension.create<EditorContext>({
  name: 'editor-context-extension',
  addProseMirrorPlugins () {
    const context = this.options
    const plugin = new Plugin<EditorContext>({
      key: editorContextPluginKey,
      state: {
        init () {
          return context
        },
        apply (tr, val) {
          const update: Partial<EditorContext> | undefined = tr.getMeta(editorContextPluginKey)
          return update !== undefined ? { ...val, ...update } : val
        }
      }
    })
    return [plugin]
  }
})

/**
 * Updates the context of an existing editor, e.g. when the space of the edited object changes.
 * Does nothing if the values are unchanged.
 */
export function updateEditorContext (editor: Editor, update: Partial<EditorContext>): void {
  if (editor.isDestroyed) return
  const current = editorContextPluginKey.getState(editor.state)
  if (current === undefined) return
  const changed = (Object.keys(update) as Array<keyof EditorContext>).some((key) => current[key] !== update[key])
  if (!changed) return
  editor.view.dispatch(editor.state.tr.setMeta(editorContextPluginKey, update).setMeta('addToHistory', false))
}
