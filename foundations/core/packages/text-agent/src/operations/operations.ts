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

import type { Awareness } from '../schema'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Node as PMNode, NodeType } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { canonicalAgentJSON, fingerprintAgentNode, indexAgentDocument, resolveAgentTarget } from './references'
import type { AgentIndex, AgentTarget } from './references'
import { AgentOperationFailure, attributeReadonly, own, parseAgentNode } from './schema'
import { AgentTextMatch, findAgentText } from './text'
import type {
  AgentError,
  AgentOperation,
  AgentOperationResult,
  AgentPolicy,
  AgentPosition,
  AgentReferenceSource,
  AgentScope
} from './types'

export interface AgentPreparedSuccess {
  ok: true
  transaction: Transaction
  results: AgentPreparedTarget[]
}

export interface AgentPreparedFailure {
  ok: false
  opIndex: number
  error: AgentError
}

export type AgentPreparedBatch = AgentPreparedSuccess | AgentPreparedFailure

/** Internal staged coordinates; public handles must be issued after the host commits to Yjs. */
export interface AgentPreparedTarget {
  opIndex: number
  target: AgentTarget
}

interface OperationContext {
  readonly awareness: Awareness
  readonly tr: Transaction
  readonly policy: AgentPolicy
  readonly targets: Map<string, AgentTarget>
}

interface ResolvedTarget {
  target: AgentTarget
  node: PMNode
}

function validateOperation (op: AgentOperation): void {
  const invalid = (): never => {
    throw new AgentOperationFailure('INVALID_OPERATION', 'Malformed or unsupported operation.')
  }
  if (typeof op !== 'object' || op === null) invalid()
  if (op.op === 'insert_node') {
    if (
      typeof op.at !== 'object' ||
      op.at === null ||
      typeof op.at.ref !== 'string' ||
      !['before', 'after', 'start', 'end'].includes(op.at.where)
    ) {
      invalid()
    }
    return
  }
  if (typeof op.ref !== 'string' || op.ref.length === 0) invalid()
  switch (op.op) {
    case 'delete_node':
      if (typeof op.expectedFingerprint !== 'string' || op.expectedFingerprint.length === 0) invalid()
      return
    case 'update_attrs':
      if (typeof op.attrs !== 'object' || op.attrs === null || Array.isArray(op.attrs)) invalid()
      return
    case 'replace_text':
    case 'add_mark':
    case 'remove_mark':
      if (typeof op.search !== 'string' || (op.all !== undefined && typeof op.all !== 'boolean')) invalid()
      if (op.op === 'replace_text' && typeof op.replace !== 'string') invalid()
      if (op.op === 'remove_mark' && typeof op.mark !== 'string') invalid()
      if (
        op.op === 'add_mark' &&
        (typeof op.mark !== 'object' || op.mark === null || typeof op.mark.type !== 'string')
      ) {
        invalid()
      }
      return
    default:
      invalid()
  }
}

function exactReplace (tr: Transaction, from: number, to: number, content: Fragment): void {
  // Transform.delete/insert may fit content and silently repair the surrounding structure.
  tr.step(new ReplaceStep(from, to, new Slice(content, 0, 0)))
}

function currentNode (tr: Transaction, target: AgentTarget): PMNode {
  const node = target.deleted ? null : tr.doc.nodeAt(target.from)
  if (node === null || node.type.name !== target.type || target.to !== target.from + node.nodeSize) {
    throw new AgentOperationFailure('STALE_REFERENCE', 'An earlier operation removed the target.')
  }
  return node
}

function insertPosition (tr: Transaction, at: AgentPosition, targets: Map<string, AgentTarget>): number {
  if (at.ref === 'root') {
    if (at.where === 'start') return 0
    if (at.where === 'end') return tr.doc.content.size
    throw new AgentOperationFailure('POSITION_INVALID', 'root supports start/end only.')
  }
  const target = targets.get(at.ref)
  if (target === undefined) throw new AgentOperationFailure('STALE_REFERENCE', 'Unknown insertion ref.')
  const node = currentNode(tr, target)
  switch (at.where) {
    case 'before':
      return target.from
    case 'after':
      return target.to
    case 'start':
    case 'end':
      if (node.isLeaf || node.isAtom) {
        throw new AgentOperationFailure('POSITION_INVALID', 'The insertion target cannot contain editable children.')
      }
      return at.where === 'start' ? target.from + 1 : target.to - 1
    default:
      throw new AgentOperationFailure('POSITION_INVALID', 'Unknown insertion position.')
  }
}

function assertInsertable (node: PMNode, policy: AgentPolicy): void {
  if (!node.isText) {
    const nodePolicy = own(policy.nodes, node.type.name)
    if (nodePolicy?.insertable !== true) {
      throw new AgentOperationFailure('FORBIDDEN', `Insertion of ${node.type.name} is not enabled.`)
    }
    for (const name of nodePolicy.protectedAttrs ?? []) {
      const value: unknown = node.attrs[name]
      if (value !== null && value !== undefined && value !== '') {
        throw new AgentOperationFailure('FORBIDDEN', `Protected attribute ${name} cannot be supplied during insertion.`)
      }
    }
  }
  if (node.marks.some((mark) => own(policy.marks, mark.type.name)?.editable !== true)) {
    throw new AgentOperationFailure('FORBIDDEN', 'Insertion cannot forge protected marks.')
  }
  node.forEach((child) => {
    assertInsertable(child, policy)
  })
}

function selectedText (
  tr: Transaction,
  target: AgentTarget,
  selector: { search: string, all?: boolean },
  policy: AgentPolicy
): AgentTextMatch[] {
  const node = currentNode(tr, target)
  if (own(policy.nodes, node.type.name)?.textEditable !== true || node.isLeaf || node.isAtom) {
    throw new AgentOperationFailure('FORBIDDEN', `Text editing in ${node.type.name} is not enabled.`)
  }
  const matches = findAgentText(node, target.from + 1, selector.search)
  if (matches.length === 0) throw new AgentOperationFailure('TEXT_NOT_FOUND', 'No literal text match in the target.')
  if (matches.length > 1 && selector.all !== true) {
    throw new AgentOperationFailure('AMBIGUOUS_MATCH', 'Multiple matches; narrow the target or use all: true.')
  }
  for (const match of matches) {
    const parent = tr.doc.resolve(match.from).parent
    if (own(policy.nodes, parent.type.name)?.textEditable !== true) {
      throw new AgentOperationFailure('FORBIDDEN', `Text editing in nested ${parent.type.name} is not enabled.`)
    }
  }
  return matches.reverse()
}

function markEditable (name: string, policy: AgentPolicy): void {
  if (own(policy.marks, name)?.editable !== true) {
    throw new AgentOperationFailure('FORBIDDEN', `Mark ${name} is protected or unsupported.`)
  }
}

function resolveTarget (ctx: OperationContext, ref: string): ResolvedTarget {
  const target = ctx.targets.get(ref)
  if (target === undefined) throw new AgentOperationFailure('STALE_REFERENCE', 'Unknown target ref.')
  return { target, node: currentNode(ctx.tr, target) }
}

function assertAttributeEditable (ctx: OperationContext, type: NodeType, name: string): void {
  if (!Object.hasOwn(type.spec.attrs ?? {}, name)) {
    throw new AgentOperationFailure('UNSUPPORTED_SCHEMA', `Unknown attribute ${name}.`)
  }
  const nodePolicy = own(ctx.policy.nodes, type.name)
  if (
    attributeReadonly(ctx.awareness, type, name) ||
    (nodePolicy?.protectedAttrs?.includes(name) ?? false) ||
    !(nodePolicy?.editableAttrs?.includes(name) ?? false)
  ) {
    throw new AgentOperationFailure('FORBIDDEN', `Attribute ${name} cannot be edited.`)
  }
}

function insertNode (ctx: OperationContext, op: Extract<AgentOperation, { op: 'insert_node' }>): AgentTarget {
  const { awareness, tr, policy, targets } = ctx
  canonicalAgentJSON(op.node)
  const node = parseAgentNode(awareness, op.node, true)
  assertInsertable(node, policy)
  if (node.isText || node.type === tr.doc.type) {
    throw new AgentOperationFailure('INVALID_OPERATION', 'Insert a non-text child node, not a document root.')
  }
  const from = insertPosition(tr, op.at, targets)
  const position = tr.doc.resolve(from)
  const parent = position.parent
  const index = position.index()
  if (!parent.canReplaceWith(index, index, node.type, node.marks)) {
    const allowed = Object.values(awareness.schema.nodes)
      .filter((type) => parent.canReplaceWith(index, index, type))
      .map((type) => type.name)
    throw new AgentOperationFailure(
      'POSITION_INVALID',
      `Cannot insert ${node.type.name} into ${parent.type.name} here. Allowed node types: ${allowed.join(', ') || '(none)'}.`
    )
  }
  exactReplace(tr, from, from, Fragment.from(node))
  return { from, to: from + node.nodeSize, type: node.type.name, deleted: false }
}

function deleteNode (ctx: OperationContext, op: Extract<AgentOperation, { op: 'delete_node' }>): AgentTarget {
  const { tr, policy } = ctx
  const { target, node } = resolveTarget(ctx, op.ref)
  if (own(policy.nodes, node.type.name)?.deletable !== true) {
    throw new AgentOperationFailure('FORBIDDEN', 'Deletion is not enabled.')
  }
  exactReplace(tr, target.from, target.to, Fragment.empty)
  return target
}

function updateAttrs (ctx: OperationContext, op: Extract<AgentOperation, { op: 'update_attrs' }>): AgentTarget {
  const { tr } = ctx
  const { target, node } = resolveTarget(ctx, op.ref)
  canonicalAgentJSON(op.attrs)
  for (const name of Object.keys(op.attrs)) assertAttributeEditable(ctx, node.type, name)
  tr.setNodeMarkup(target.from, undefined, { ...node.attrs, ...op.attrs }, node.marks)
  return target
}

function replaceText (ctx: OperationContext, op: Extract<AgentOperation, { op: 'replace_text' }>): AgentTarget {
  const { tr, policy } = ctx
  const { target } = resolveTarget(ctx, op.ref)
  for (const match of selectedText(tr, target, op, policy)) {
    const initial = match.spans[0].marks
    // Ordinary formatting comes from the start. Only anchors covering the whole match are inherited.
    const marks = initial.filter(
      (mark) =>
        own(policy.marks, mark.type.name)?.editable === true ||
        match.spans.every((span) => span.marks.some((candidate) => candidate.eq(mark)))
    )
    const content = op.replace.length === 0 ? Fragment.empty : Fragment.from(tr.doc.type.schema.text(op.replace, marks))
    exactReplace(tr, match.from, match.to, content)
  }
  return target
}

function addMark (ctx: OperationContext, op: Extract<AgentOperation, { op: 'add_mark' }>): AgentTarget {
  const { awareness, tr, policy } = ctx
  const { target } = resolveTarget(ctx, op.ref)
  markEditable(op.mark.type, policy)
  const parsed = parseAgentNode(awareness, { type: 'text', text: 'x', marks: [op.mark] }, true)
  const mark = parsed.marks[0]
  if (mark === undefined) throw new AgentOperationFailure('SCHEMA_INVALID', 'Invalid mark.')
  for (const match of selectedText(tr, target, op, policy)) {
    for (const span of match.spans) {
      const after = mark.addToSet(span.marks)
      const protectedMarks = span.marks.filter((existing) => own(policy.marks, existing.type.name)?.editable !== true)
      if (protectedMarks.some((existing) => !after.some((candidate) => candidate.eq(existing)))) {
        throw new AgentOperationFailure('FORBIDDEN', 'This mark would remove protected comment anchors.')
      }
      const parent = tr.doc.resolve(Math.max(span.from, match.from)).parent
      if (!parent.type.allowsMarkType(mark.type) || !after.some((candidate) => candidate.eq(mark))) {
        throw new AgentOperationFailure('SCHEMA_INVALID', 'The mark is not allowed in this text range.')
      }
    }
    tr.addMark(match.from, match.to, mark)
  }
  return target
}

function removeMark (ctx: OperationContext, op: Extract<AgentOperation, { op: 'remove_mark' }>): AgentTarget {
  const { tr, policy } = ctx
  const { target } = resolveTarget(ctx, op.ref)
  markEditable(op.mark, policy)
  const type = own(tr.doc.type.schema.marks, op.mark)
  if (type === undefined) throw new AgentOperationFailure('UNSUPPORTED_SCHEMA', `Unknown mark ${op.mark}.`)
  for (const match of selectedText(tr, target, op, policy)) tr.removeMark(match.from, match.to, type)
  return target
}

function assertNever (_op: never): never {
  throw new AgentOperationFailure('INVALID_OPERATION', 'Unsupported operation.')
}

function applyOne (ctx: OperationContext, op: AgentOperation): AgentTarget {
  switch (op.op) {
    case 'insert_node':
      return insertNode(ctx, op)
    case 'delete_node':
      return deleteNode(ctx, op)
    case 'update_attrs':
      return updateAttrs(ctx, op)
    case 'replace_text':
      return replaceText(ctx, op)
    case 'add_mark':
      return addMark(ctx, op)
    case 'remove_mark':
      return removeMark(ctx, op)
    default:
      return assertNever(op)
  }
}

function updateTargets (tr: Transaction, start: number, targets: Set<AgentTarget>): void {
  const mapping = tr.mapping.slice(start)
  for (const target of targets) {
    if (target.deleted) continue
    target.from = mapping.map(target.from, 1)
    target.to = mapping.map(target.to, -1)
    if (target.from >= target.to) target.deleted = true
  }
}

/**
 * Compile a complete batch without dispatching or modifying the input state.
 * The host must authorize the request and commit the returned transaction against the same live snapshot.
 */
export function prepareAgentOperations (
  awareness: Awareness,
  state: EditorState,
  ops: readonly AgentOperation[],
  scope: AgentScope,
  policy: AgentPolicy,
  references: AgentReferenceSource
): AgentPreparedBatch {
  let opIndex = 0
  try {
    if (!Array.isArray(ops)) throw new AgentOperationFailure('INVALID_OPERATION', 'Expected an array of operations.')
    if (ops.length > 100) throw new AgentOperationFailure('TOO_MANY_OPS', 'At most 100 operations per batch.')
    if (state.schema !== awareness.schema) {
      throw new AgentOperationFailure('SCHEMA_INVALID', 'EditorState must use the schema owned by Awareness.')
    }
    const first = ops[0]
    const initialInsertion = state.doc.childCount === 0 && first?.op === 'insert_node' && first.at.ref === 'root'
    if (!initialInsertion) state.doc.check()
    canonicalAgentJSON(state.doc.toJSON())
    const index = indexAgentDocument(state.doc, scope, references)
    const targets = new Map<string, AgentTarget>()
    // All public refs belong to the initial snapshot; later operations follow internal mapped handles.
    for (opIndex = 0; opIndex < ops.length; opIndex++) {
      const op = ops[opIndex]
      validateOperation(op)
      const ref = op.op === 'insert_node' ? op.at.ref : op.ref
      if (ref !== 'root' && !targets.has(ref)) targets.set(ref, resolveAgentTarget(index, ref))
      if (op.op === 'delete_node') {
        const target = targets.get(ref)
        const node = target === undefined ? null : state.doc.nodeAt(target.from)
        if (node === null || fingerprintAgentNode(node, scope) !== op.expectedFingerprint) {
          throw new AgentOperationFailure(
            'STALE_REFERENCE',
            'The subtree changed after the read. Read it again before deletion.'
          )
        }
      }
    }
    const tracked = new Set(targets.values())
    const pending: AgentPreparedTarget[] = []
    const tr = state.tr
    const ctx: OperationContext = { awareness, tr, policy, targets }
    for (opIndex = 0; opIndex < ops.length; opIndex++) {
      const mapStart = tr.mapping.maps.length
      const target = applyOne(ctx, ops[opIndex])
      tr.doc.check()
      updateTargets(tr, mapStart, tracked)
      tracked.add(target)
      pending.push({ opIndex, target })
    }
    tr.setMeta('agent', true)
    return { ok: true, transaction: tr, results: pending }
  } catch (error: unknown) {
    return {
      ok: false,
      opIndex,
      error:
        error instanceof AgentOperationFailure
          ? { code: error.code, message: error.message }
          : { code: 'SCHEMA_INVALID', message: error instanceof Error ? error.message : 'Invalid operation.' }
    }
  }
}

/** Issue response handles only after reconciliation has created the actual live containers. */
export function finalizeAgentOperations (prepared: AgentPreparedSuccess, current: AgentIndex): AgentOperationResult[] {
  if (!current.doc.eq(prepared.transaction.doc)) {
    throw new AgentOperationFailure('STALE_REFERENCE', 'The committed document differs from the prepared result.')
  }
  const byPosition = new Map<number, { ref: string, fingerprint: string, type: string }>()
  for (const entry of current.entries) {
    const target = resolveAgentTarget(current, entry.ref)
    byPosition.set(target.from, entry)
  }
  return prepared.results.map(({ opIndex, target }) => {
    if (target.deleted) return { opIndex, deleted: true }
    const entry = byPosition.get(target.from)
    if (entry === undefined || entry.type !== target.type) {
      throw new AgentOperationFailure('STALE_REFERENCE', 'The committed target no longer exists.')
    }
    return { opIndex, ref: entry.ref, fingerprint: entry.fingerprint }
  })
}
