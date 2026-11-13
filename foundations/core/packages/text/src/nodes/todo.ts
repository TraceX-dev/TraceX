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

import { TaskItem, TaskList } from '@tiptap/extension-list'
import type { Attributes } from '@tiptap/core'

import { getDataAttribute } from './utils'

export const TodoItemNode = TaskItem.extend({
  name: 'todoItem',
  group: 'listItems',

  addSchemaAwareness () {
    return {
      label: 'Todo item',
      description: 'Checkable list item. Existing todo and assignee links are managed outside the document.',
      attributes: {
        checked: { description: 'Completion state.' },
        todoid: { access: 'readonly', description: 'Existing linked todo ID.' },
        userid: { access: 'readonly', description: 'Existing assignee ID.' }
      },
      example: {
        type: this.name,
        attrs: { checked: false },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Buy milk' }] }]
      }
    }
  },

  addOptions () {
    return {
      nested: true,
      HTMLAttributes: {},
      taskListTypeName: 'todoList'
    }
  },

  addAttributes () {
    const attributes: Attributes = this.parent?.() ?? {}
    return {
      ...attributes,
      checked: { ...attributes.checked, validate: 'boolean' },
      todoid: getDataAttribute('todoid', { default: null, keepOnSplit: false, validate: 'string|null' }),
      userid: getDataAttribute('userid', { default: null, keepOnSplit: false, validate: 'string|null' })
    }
  }
})

export const TodoListNode = TaskList.extend({
  name: 'todoList',

  addSchemaAwareness () {
    return { label: 'Todo list', description: 'Checklist of checkable items.' }
  },

  addOptions () {
    return {
      itemTypeName: 'todoItem',
      HTMLAttributes: {}
    }
  }
})
