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

import { Mark, Node } from '@tiptap/core'
import { Awareness } from '../../schema'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import {
  canonicalAgentJSON,
  fingerprintAgentNode,
  finalizeAgentOperations,
  indexAgentDocument,
  parseAgentNode,
  prepareAgentOperations as prepareWithReferences,
  resolveAgentTarget
} from '../index'
import type {
  AgentOperation,
  AgentPolicy,
  AgentScope,
  AgentPreparedSuccess,
  AgentReferenceSource,
  AgentPreparedBatch
} from '../index'

const awareness = new Awareness([
  Node.create({ name: 'doc', topNode: true, content: 'block+' }),
  Node.create({
    name: 'paragraph',
    group: 'block',
    content: 'inline*',
    addAttributes () {
      return { uid: { default: null }, align: { default: null, validate: 'string|null' } }
    }
  }),
  Node.create({
    name: 'heading',
    group: 'block',
    content: 'inline*',
    addAttributes () {
      return { uid: { default: null } }
    }
  }),
  Node.create({ name: 'blockquote', group: 'block', content: 'block+' }),
  Node.create({ name: 'codeBlock', group: 'block', content: 'text*', marks: '' }),
  Node.create({ name: 'text', group: 'inline' }),
  Node.create({ name: 'hardBreak', group: 'inline', inline: true }),
  Node.create({
    name: 'reference',
    group: 'inline',
    inline: true,
    atom: true,
    addAttributes () {
      return { id: { default: undefined, isRequired: true } }
    }
  }),
  Mark.create({ name: 'bold' }),
  Mark.create({ name: 'italic' }),
  Mark.create({
    name: 'link',
    addAttributes () {
      return { href: { default: undefined, isRequired: true, validate: 'string' } }
    }
  }),
  Mark.create({ name: 'code', excludes: '_' }),
  Mark.create({
    name: 'comment',
    excludes: '',
    addAttributes () {
      return { thread: { default: undefined, isRequired: true } }
    }
  })
])
const schema = awareness.schema

const policy: AgentPolicy = {
  nodes: {
    paragraph: {
      protectedAttrs: ['uid'],
      editableAttrs: ['align'],
      insertable: true,
      deletable: true,
      textEditable: true
    },
    heading: { protectedAttrs: ['uid'], insertable: true, deletable: true, textEditable: true },
    blockquote: { insertable: true, deletable: true, textEditable: true },
    codeBlock: { insertable: true, deletable: true, textEditable: true },
    reference: { insertable: true, deletable: true },
    hardBreak: { insertable: true }
  },
  marks: { bold: { editable: true }, italic: { editable: true }, link: { editable: true }, code: { editable: true } }
}

const scope: AgentScope = {
  document: 'workspace|class|document|content',
  field: 'content',
  // Collision-free fixture encoding; the server integration probe supplies SHA-256.
  hash: (value) => encodeURIComponent(value)
}

const handles = new WeakMap<object, string>()
let nextHandle = 0
// Unit adapter only. Real identity and lifecycle guarantees are tested with Yjs on the integration stand.
const references: AgentReferenceSource = {
  document: scope.document,
  field: scope.field,
  refForNode: (node) => {
    let ref = handles.get(node)
    if (ref === undefined) {
      ref = `fixture:${nextHandle++}`
      handles.set(node, ref)
    }
    return ref
  }
}

function prepareAgentOperations (
  input: EditorState,
  ops: readonly AgentOperation[],
  context: AgentScope,
  permissions: AgentPolicy
): AgentPreparedBatch {
  return prepareWithReferences(awareness, input, ops, context, permissions, references)
}

function deleteOp (doc: PMNode, path = '0'): AgentOperation {
  const entry = indexAgentDocument(doc, scope, references).entries.find((entry) => entry.path.join('/') === path)
  if (entry === undefined) throw new Error('Missing deletion fixture')
  return { op: 'delete_node', ref: entry.ref, expectedFingerprint: entry.fingerprint }
}

function paragraph (text: string, uid?: string): PMNode {
  return schema.nodes.paragraph.create(uid === undefined ? null : { uid }, text.length === 0 ? [] : schema.text(text))
}

function state (...nodes: PMNode[]): EditorState {
  return EditorState.create({ schema, doc: schema.nodes.doc.create(null, nodes) })
}

function refAt (doc: PMNode, path = '0'): string {
  const entry = indexAgentDocument(doc, scope, references).entries.find((entry) => entry.path.join('/') === path)
  if (entry === undefined) throw new Error(`Missing fixture node ${path}`)
  return entry.ref
}

function success (value: ReturnType<typeof prepareAgentOperations>): AgentPreparedSuccess {
  if (!value.ok) throw new Error(`${value.opIndex}: ${value.error.code}: ${value.error.message}`)
  return value
}

function resolveNode (doc: PMNode, scope: AgentScope, source: AgentReferenceSource, ref: string): any {
  const index = indexAgentDocument(doc, scope, source)
  const target = resolveAgentTarget(index, ref)
  const node = doc.nodeAt(target.from)
  if (node === null) throw new Error('Expected an indexed node')
  return node.toJSON()
}

describe('agent document refs and schema', () => {
  it('reads old documents without creating IDs or changing content', () => {
    const input = state(paragraph('hello'))
    const before = JSON.stringify(input.doc.toJSON())
    const ref = refAt(input.doc)
    expect(ref).toMatch(/^fixture:/)
    expect(resolveNode(input.doc, scope, references, ref).attrs?.uid).toBeNull()
    expect(JSON.stringify(input.doc.toJSON())).toBe(before)
  })

  it('distinguishes identical blocks using the adapter rather than their content or path', () => {
    const input = state(paragraph('same'), paragraph('same'))
    expect(refAt(input.doc)).not.toBe(refAt(input.doc, '1'))
    const changed = state(paragraph('different'), paragraph('same'))
    expect(() => resolveNode(changed.doc, scope, references, refAt(input.doc))).toThrow('no longer resolves')
    const shifted = state(paragraph('prefix'), input.doc.child(0), input.doc.child(1))
    expect(resolveNode(shifted.doc, scope, references, refAt(input.doc)).content?.[0].text).toBe('same')
  })

  it('scopes refs to the document and field', () => {
    const input = state(paragraph('hello', 'stable'))
    expect(() => resolveNode(input.doc, { ...scope, field: 'other' }, references, refAt(input.doc))).toThrow()
    expect(() => resolveNode(input.doc, { ...scope, document: 'other' }, references, refAt(input.doc))).toThrow()
  })

  it('ignores duplicate uid attributes for addressing', () => {
    const input = state(paragraph('first', 'duplicate'), paragraph('second', 'duplicate'))
    expect(refAt(input.doc)).not.toBe(refAt(input.doc, '1'))
    expect(resolveNode(input.doc, scope, references, refAt(input.doc)).content?.[0].text).toBe('first')
  })

  it('does not treat a business reference id as node identity', () => {
    const doc = state(schema.nodes.paragraph.create(null, schema.nodes.reference.create({ id: 'external-doc' }))).doc
    expect(refAt(doc, '0/0')).toMatch(/^fixture:/)
  })

  it('canonicalizes object keys but preserves arrays, marks and attributes', () => {
    expect(canonicalAgentJSON({ b: 2, a: 1 })).toBe(canonicalAgentJSON({ a: 1, b: 2 }))
    expect(canonicalAgentJSON([1, 2])).not.toBe(canonicalAgentJSON([2, 1]))
    expect(() => canonicalAgentJSON({ lost: undefined })).toThrow()
    expect(() => canonicalAgentJSON({ invalid: Number.NaN })).toThrow()
  })

  it.each([
    { type: 'unknown' },
    { type: 'paragraph', attrs: { lost: 'value' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'missing' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'bold', attrs: { lost: 1 } }] }] },
    { type: 'paragraph', unexpected: true }
  ])('rejects unsupported raw JSON before conversion: %j', (raw) => {
    expect(() => parseAgentNode(awareness, raw)).toThrow()
  })
})

describe('preparing agent operation batches', () => {
  it('stages all changes without dispatch or input mutation', () => {
    const input = state(paragraph('hello'))
    const result = success(
      prepareAgentOperations(
        input,
        [{ op: 'replace_text', ref: refAt(input.doc), search: 'hello', replace: 'world' }],
        scope,
        policy
      )
    )
    expect(result.transaction.doc.textContent).toBe('world')
    expect(input.doc.textContent).toBe('hello')
    expect(finalizeAgentOperations(result, indexAgentDocument(result.transaction.doc, scope, references))[0].ref).toBe(
      refAt(result.transaction.doc)
    )
    expect(result.transaction.getMeta('agent')).toBe(true)
  })

  it('uses the same initial snapshot ref after its own attribute, text and sibling changes', () => {
    const input = state(paragraph('hello'))
    const ref = refAt(input.doc)
    const operations: AgentOperation[] = [
      { op: 'update_attrs', ref, attrs: { align: 'center' } },
      {
        op: 'insert_node',
        at: { ref, where: 'before' },
        node: { type: 'paragraph', content: [{ type: 'text', text: 'prefix' }] }
      },
      { op: 'replace_text', ref, search: 'hello', replace: 'world' },
      { op: 'add_mark', ref, search: 'world', mark: { type: 'bold' } }
    ]
    const result = success(prepareAgentOperations(input, operations, scope, policy))
    const target = result.transaction.doc.child(1)
    expect(target.textContent).toBe('world')
    expect(target.attrs.align).toBe('center')
    expect(target.firstChild?.marks[0].type.name).toBe('bold')
    expect(result.results[0].target.from).toBe(result.results[2].target.from)
  })

  it('leaves the input unchanged when the last operation fails', () => {
    const input = state(paragraph('hello'))
    const ref = refAt(input.doc)
    const result = prepareAgentOperations(
      input,
      [
        { op: 'replace_text', ref, search: 'hello', replace: 'world' },
        { op: 'replace_text', ref, search: 'missing', replace: 'x' }
      ],
      scope,
      policy
    )
    expect(result).toMatchObject({ ok: false, opIndex: 1, error: { code: 'TEXT_NOT_FOUND' } })
    expect(input.doc.textContent).toBe('hello')
  })

  it('refuses deletion of the last required block instead of inserting a filler paragraph', () => {
    const input = state(paragraph('only'))
    expect(prepareAgentOperations(input, [deleteOp(input.doc)], scope, policy).ok).toBe(false)
    expect(input.doc.textContent).toBe('only')
  })

  it('does not redirect a deleted ref to the next sibling', () => {
    const input = state(paragraph('one'), paragraph('two'))
    const ref = refAt(input.doc)
    const result = prepareAgentOperations(
      input,
      [deleteOp(input.doc), { op: 'replace_text', ref, search: 'two', replace: 'wrong' }],
      scope,
      policy
    )
    expect(result).toMatchObject({ ok: false, opIndex: 1, error: { code: 'STALE_REFERENCE' } })
  })

  it('invalidates a child target after parent deletion', () => {
    const input = state(schema.nodes.blockquote.create(null, paragraph('nested')), paragraph('other'))
    const childRef = refAt(input.doc, '0/0')
    const result = prepareAgentOperations(
      input,
      [deleteOp(input.doc), { op: 'replace_text', ref: childRef, search: 'nested', replace: 'x' }],
      scope,
      policy
    )
    expect(result).toMatchObject({ ok: false, opIndex: 1, error: { code: 'STALE_REFERENCE' } })
  })

  it('does not copy an existing identity into an inserted subtree', () => {
    const input = state(paragraph('one', 'stable'))
    const result = prepareAgentOperations(
      input,
      [
        {
          op: 'insert_node',
          at: { ref: 'root', where: 'end' },
          node: { type: 'paragraph', attrs: { uid: 'stable' } }
        }
      ],
      scope,
      policy
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  })

  it('returns a fresh ref for an inserted node without generating an ID', () => {
    const input = state(paragraph('one'))
    const result = success(
      prepareAgentOperations(
        input,
        [{ op: 'insert_node', at: { ref: 'root', where: 'end' }, node: { type: 'paragraph' } }],
        scope,
        policy
      )
    )
    expect(result.transaction.doc.child(1).attrs.uid).toBeNull()
    expect(finalizeAgentOperations(result, indexAgentDocument(result.transaction.doc, scope, references))[0].ref).toBe(
      refAt(result.transaction.doc, '1')
    )
  })

  it('rejects an invalid insertion without fitting or wrapping the node', () => {
    const input = state(paragraph('one'))
    const result = prepareAgentOperations(
      input,
      [{ op: 'insert_node', at: { ref: refAt(input.doc), where: 'start' }, node: { type: 'paragraph' } }],
      scope,
      policy
    )
    expect(result.ok).toBe(false)
    expect(input.doc.childCount).toBe(1)
  })

  it.each(['uid', 'notAnAttribute'])('protects identity and unknown attributes: %s', (name) => {
    const input = state(paragraph('one', 'stable'))
    const result = prepareAgentOperations(
      input,
      [{ op: 'update_attrs', ref: refAt(input.doc), attrs: { [name]: 'changed' } }],
      scope,
      policy
    )
    expect(result.ok).toBe(false)
  })

  it('validates attribute types', () => {
    const input = state(paragraph('one'))
    expect(
      prepareAgentOperations(
        input,
        [{ op: 'update_attrs', ref: refAt(input.doc), attrs: { align: 42 } }],
        scope,
        policy
      ).ok
    ).toBe(false)
  })

  it('limits batches and handles empty batches', () => {
    const input = state(paragraph('one'))
    expect(prepareAgentOperations(input, [], scope, policy)).toMatchObject({ ok: true, results: [] })
    const operation = deleteOp(input.doc)
    expect(
      prepareAgentOperations(
        input,
        Array.from({ length: 101 }, () => operation),
        scope,
        policy
      )
    ).toMatchObject({ ok: false, error: { code: 'TOO_MANY_OPS' } })
  })
})

describe('deletion preconditions and response finalization', () => {
  it('checks deletion against the initial snapshot, before its own text edits', () => {
    const input = state(paragraph('hello'), paragraph('keep'))
    const result = success(
      prepareAgentOperations(
        input,
        [{ op: 'replace_text', ref: refAt(input.doc), search: 'hello', replace: 'changed' }, deleteOp(input.doc)],
        scope,
        policy
      )
    )
    expect(result.transaction.doc.textContent).toBe('keep')
    expect(finalizeAgentOperations(result, indexAgentDocument(result.transaction.doc, scope, references))).toEqual([
      { opIndex: 0, deleted: true },
      { opIndex: 1, deleted: true }
    ])
  })

  it.each(['attrs', 'marks', 'nested', 'embedded'])(
    'detects a changed %s even when the visible text stays the same',
    (kind) => {
      const before = paragraph('same')
      let changed = paragraph('same')
      if (kind === 'attrs') changed = schema.nodes.paragraph.create({ align: 'center' }, schema.text('same'))
      if (kind === 'marks') {
        changed = schema.nodes.paragraph.create(null, schema.text('same', [schema.marks.bold.create()]))
      }
      if (kind === 'nested') changed = schema.nodes.blockquote.create(null, [paragraph('same'), paragraph('')])
      if (kind === 'embedded') {
        changed = schema.nodes.paragraph.create(null, [
          schema.text('same'),
          schema.nodes.reference.create({ id: 'object' })
        ])
      }
      expect(changed.textContent).toBe(before.textContent)
      const input = state(changed, paragraph('keep'))
      const operation: AgentOperation = {
        op: 'delete_node',
        ref: refAt(input.doc),
        expectedFingerprint: fingerprintAgentNode(before, scope)
      }
      expect(prepareAgentOperations(input, [operation], scope, policy)).toMatchObject({
        ok: false,
        opIndex: 0,
        error: { code: 'STALE_REFERENCE' }
      })
    }
  )

  it('requires an explicit deletion fingerprint', () => {
    const input = state(paragraph('hello'), paragraph('keep'))
    const invalid = { op: 'delete_node', ref: refAt(input.doc) }
    expect(prepareAgentOperations(input, [invalid as AgentOperation], scope, policy)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_OPERATION' }
    })
  })

  it('does not issue a new handle before commit and refuses finalization against another document', () => {
    const input = state(paragraph('hello'))
    const result = success(
      prepareAgentOperations(
        input,
        [{ op: 'insert_node', at: { ref: 'root', where: 'end' }, node: { type: 'paragraph' } }],
        scope,
        policy
      )
    )
    expect(result.results[0]).not.toHaveProperty('ref')
    expect(() => finalizeAgentOperations(result, indexAgentDocument(input.doc, scope, references))).toThrow('differs')
  })
})

describe('literal text and formatting', () => {
  it('replaces across mark boundaries and inherits initial ordinary formatting', () => {
    const input = state(
      schema.nodes.paragraph.create(null, [schema.text('hel', [schema.marks.bold.create()]), schema.text('lo')])
    )
    const result = success(
      prepareAgentOperations(
        input,
        [{ op: 'replace_text', ref: refAt(input.doc), search: 'hello', replace: 'new' }],
        scope,
        policy
      )
    )
    expect(result.transaction.doc.textContent).toBe('new')
    expect(result.transaction.doc.firstChild?.firstChild?.marks[0].type.name).toBe('bold')
  })

  it('requires an unambiguous match unless all is explicit', () => {
    const input = state(paragraph('one one'))
    const operation: AgentOperation = { op: 'replace_text', ref: refAt(input.doc), search: 'one', replace: 'two' }
    expect(prepareAgentOperations(input, [operation], scope, policy)).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS_MATCH' }
    })
    const all: AgentOperation = { ...operation, all: true }
    expect(success(prepareAgentOperations(input, [all], scope, policy)).transaction.doc.textContent).toBe('two two')
  })

  it.each(['hardBreak', 'reference'])('does not match across an inline boundary: %s', (name) => {
    const atom = schema.nodes[name].create(name === 'reference' ? { id: 'resource' } : null)
    const input = state(schema.nodes.paragraph.create(null, [schema.text('one'), atom, schema.text('two')]))
    expect(
      prepareAgentOperations(
        input,
        [{ op: 'replace_text', ref: refAt(input.doc), search: 'onetwo', replace: 'x' }],
        scope,
        policy
      )
    ).toMatchObject({ ok: false, error: { code: 'TEXT_NOT_FOUND' } })
  })

  it('does not match across child block boundaries', () => {
    const input = state(schema.nodes.blockquote.create(null, [paragraph('one'), paragraph('two')]))
    expect(
      prepareAgentOperations(
        input,
        [{ op: 'replace_text', ref: refAt(input.doc), search: 'onetwo', replace: 'x' }],
        scope,
        policy
      )
    ).toMatchObject({ ok: false, error: { code: 'TEXT_NOT_FOUND' } })
  })

  it('applies and removes ordinary marks without removing protected anchors', () => {
    const comment = schema.marks.comment.create({ thread: 'thread' })
    const input = state(schema.nodes.paragraph.create(null, schema.text('hello', [comment])))
    const ref = refAt(input.doc)
    const result = success(
      prepareAgentOperations(
        input,
        [
          { op: 'add_mark', ref, search: 'hello', mark: { type: 'bold' } },
          { op: 'add_mark', ref, search: 'hello', mark: { type: 'link', attrs: { href: 'https://example.com' } } },
          { op: 'remove_mark', ref, search: 'hello', mark: 'bold' }
        ],
        scope,
        policy
      )
    )
    expect(result.transaction.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name)).toEqual([
      'link',
      'comment'
    ])
  })

  it('preserves an anchor covering the entire replacement', () => {
    const comment = schema.marks.comment.create({ thread: 'thread' })
    const input = state(schema.nodes.paragraph.create(null, schema.text('hello', [comment])))
    const result = success(
      prepareAgentOperations(
        input,
        [{ op: 'replace_text', ref: refAt(input.doc), search: 'hello', replace: 'world' }],
        scope,
        policy
      )
    )
    expect(result.transaction.doc.firstChild?.firstChild?.marks[0].attrs.thread).toBe('thread')
  })

  it('does not expand a partial comment anchor to the whole replacement', () => {
    const comment = schema.marks.comment.create({ thread: 'thread' })
    const input = state(schema.nodes.paragraph.create(null, [schema.text('he', [comment]), schema.text('llo')]))
    const result = success(
      prepareAgentOperations(
        input,
        [{ op: 'replace_text', ref: refAt(input.doc), search: 'hello', replace: 'world' }],
        scope,
        policy
      )
    )
    expect(result.transaction.doc.firstChild?.firstChild?.marks).toEqual([])
  })

  it.each(['add_mark', 'remove_mark'])('forbids direct editing of protected marks: %s', (op) => {
    const input = state(paragraph('hello'))
    const ref = refAt(input.doc)
    const operation: AgentOperation =
      op === 'add_mark'
        ? { op: 'add_mark', ref, search: 'hello', mark: { type: 'comment', attrs: { thread: 'forged' } } }
        : { op: 'remove_mark', ref, search: 'hello', mark: 'comment' }
    expect(prepareAgentOperations(input, [operation], scope, policy)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' }
    })
  })

  it('rejects marks that would implicitly remove protected anchors', () => {
    const input = state(
      schema.nodes.paragraph.create(null, schema.text('hello', [schema.marks.comment.create({ thread: 'thread' })]))
    )
    expect(
      prepareAgentOperations(
        input,
        [{ op: 'add_mark', ref: refAt(input.doc), search: 'hello', mark: { type: 'code' } }],
        scope,
        policy
      )
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  })

  it('rejects formatting where the parent disallows marks', () => {
    const input = state(schema.nodes.codeBlock.create(null, schema.text('hello')))
    expect(
      prepareAgentOperations(
        input,
        [{ op: 'add_mark', ref: refAt(input.doc), search: 'hello', mark: { type: 'bold' } }],
        scope,
        policy
      ).ok
    ).toBe(false)
  })
})
