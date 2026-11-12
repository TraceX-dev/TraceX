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

import {
  Awareness,
  getEditorContext,
  getAgentSchemaCatalog,
  indexAgentDocument,
  prepareAgentOperations
} from '@hcengineering/text-agent'
import { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ServerKit } from '@hcengineering/text'
import type {
  AgentNodeJSON,
  AgentOperation,
  AgentPolicy,
  AgentPreparedBatch,
  AgentReferenceSource,
  AgentScope
} from '@hcengineering/text-agent'

const awareness = new Awareness([ServerKit])
const schema = awareness.schema
const scope: AgentScope = { document: 'document', field: 'content', hash: (value) => value }
const handles = new WeakMap<object, string>()
let nextHandle = 0
const references: AgentReferenceSource = {
  document: scope.document,
  field: scope.field,
  refForNode: (node) => {
    let handle = handles.get(node)
    if (handle === undefined) {
      handle = `fixture:${nextHandle++}`
      handles.set(node, handle)
    }
    return handle
  }
}
// Deliberately permissive capabilities must not override extension-owned readonly attributes.
const policy: AgentPolicy = {
  nodes: {
    todoList: { insertable: true },
    todoItem: { insertable: true, editableAttrs: ['checked', 'todoid', 'userid'] },
    paragraph: { insertable: true, textEditable: true },
    emoji: { insertable: true },
    image: { insertable: true, editableAttrs: ['align', 'display'] }
  },
  marks: { note: { editable: true }, 'inline-comment': { editable: true } }
}

function state (): EditorState {
  return EditorState.create({
    schema,
    doc: schema.node('doc', null, [
      schema.node('todoList', null, [
        schema.node('todoItem', { todoid: 'existing-task', userid: 'existing-user' }, [
          schema.node('paragraph', null, schema.text('Buy milk'))
        ])
      ]),
      schema.node('paragraph', null, schema.text('Some text'))
    ])
  })
}

function refFor (doc: PMNode, type: string): string {
  const entry = indexAgentDocument(doc, scope, references).entries.find((item) => item.type === type)
  if (entry === undefined) throw new Error(`Missing ${type} fixture`)
  return entry.ref
}

function apply (input: EditorState, ops: AgentOperation[]): AgentPreparedBatch {
  return prepareAgentOperations(awareness, input, ops, scope, policy, references)
}

function insert (node: AgentNodeJSON): AgentOperation {
  return { op: 'insert_node', at: { ref: 'root', where: 'end' }, node }
}

describe('schema awareness enforced by agent operations', () => {
  it('rejects a different awareness instance even when its schema has the same shape', () => {
    const input = state()
    const other = new Awareness([ServerKit])
    expect(prepareAgentOperations(other, input, [], scope, policy, references)).toMatchObject({
      ok: false,
      error: { code: 'SCHEMA_INVALID' }
    })
    expect(input.doc.firstChild?.firstChild?.attrs.todoid).toBe('existing-task')
  })

  it.each(['todoid', 'userid'])('rejects both clearing and reassigning readonly %s', (name) => {
    const input = state()
    for (const value of [null, 'forged-id']) {
      expect(
        apply(input, [{ op: 'update_attrs', ref: refFor(input.doc, 'todoItem'), attrs: { [name]: value } }])
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    }
    expect(input.doc.firstChild?.firstChild?.attrs.todoid).toBe('existing-task')
  })

  it.each([null, 'existing-task'])('rejects supplied readonly attributes in nested inserted nodes: %s', (value) => {
    const node: AgentNodeJSON = {
      type: 'todoList',
      content: [
        {
          type: 'todoItem',
          attrs: { todoid: value },
          content: [{ type: 'paragraph' }]
        }
      ]
    }
    const input = state()
    expect(apply(input, [insert(node)])).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(input.doc.childCount).toBe(2)
  })

  it('inserts the documented todo example without copying external links', () => {
    const input = state()
    const example = getEditorContext(awareness).nodes.todoItem.example
    if (example === undefined) throw new Error('Missing todo example')
    const node: AgentNodeJSON = { type: 'todoList', content: [example as AgentNodeJSON] }
    const result = apply(input, [insert(node)])
    if (!result.ok) throw new Error(result.error.message)
    expect(result.transaction.doc.lastChild?.firstChild?.attrs.todoid).toBeNull()
    expect(result.transaction.doc.lastChild?.firstChild?.attrs.userid).toBeNull()
  })

  it('edits checked while preserving existing readonly links', () => {
    const input = state()
    const result = apply(input, [{ op: 'update_attrs', ref: refFor(input.doc, 'todoItem'), attrs: { checked: true } }])
    if (!result.ok) throw new Error(result.error.message)
    expect(result.transaction.doc.firstChild?.firstChild?.attrs).toMatchObject({
      checked: true,
      todoid: 'existing-task',
      userid: 'existing-user'
    })
    expect(input.doc.firstChild?.firstChild?.attrs.checked).toBe(false)
  })

  it('rejects wrong native attribute types and leaves a batch unapplied', () => {
    const input = state()
    const ref = refFor(input.doc, 'todoItem')
    expect(
      apply(input, [
        { op: 'update_attrs', ref, attrs: { checked: true } },
        { op: 'update_attrs', ref, attrs: { checked: 'true' } }
      ])
    ).toMatchObject({ ok: false, opIndex: 1, error: { code: 'SCHEMA_INVALID' } })
    expect(input.doc.firstChild?.firstChild?.attrs.checked).toBe(false)
  })

  it('validates enum values on inserted nodes', () => {
    const input = state()
    const valid: AgentNodeJSON = {
      type: 'paragraph',
      content: [{ type: 'emoji', attrs: { kind: 'unicode', emoji: '🙂' } }]
    }
    expect(apply(input, [insert(valid)]).ok).toBe(true)
    const invalid: AgentNodeJSON = { type: 'paragraph', content: [{ type: 'emoji', attrs: { kind: 'forged' } }] }
    expect(apply(input, [insert(invalid)])).toMatchObject({ ok: false, error: { code: 'SCHEMA_INVALID' } })
  })

  it('validates mark attributes and refuses supplied readonly comment identities', () => {
    const input = state()
    const ref = refFor(input.doc, 'paragraph')
    expect(
      apply(input, [{ op: 'add_mark', ref, search: 'Buy milk', mark: { type: 'note', attrs: { kind: 'forged' } } }])
    ).toMatchObject({ ok: false, error: { code: 'SCHEMA_INVALID' } })
    expect(
      apply(input, [
        { op: 'add_mark', ref, search: 'Buy milk', mark: { type: 'inline-comment', attrs: { thread: 'forged' } } }
      ])
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  })
})

describe('agent schema catalog', () => {
  const context = getEditorContext(awareness)
  it('publishes every compiled type once with extension-owned descriptions and native nesting', () => {
    const catalog = getAgentSchemaCatalog(awareness)
    for (const item of Object.values({ ...context.nodes, ...context.marks })) {
      expect(item.description?.length).toBeGreaterThan(0)
      const entries = catalog
        .split('\n')
        .filter((line) => line.startsWith(`${item.name}:`) || line.startsWith(`${item.name}(`))
      expect(entries.filter((line) => line.includes(item.description!.split(/(?<=\.)\s/)[0]))).toHaveLength(1)
    }
    expect(catalog).toContain('bulletList: (listItem|todoItem)+')
    expect(catalog).toContain('tableCell: block+; only inside tableRow')
    expect(catalog).toContain('listItem: paragraph block*; only inside bulletList|orderedList')
    expect(catalog).toContain('textAlign=left|center|right')
    expect(catalog).not.toContain('todoid')
    expect(catalog).not.toContain('userid')
  })
})
