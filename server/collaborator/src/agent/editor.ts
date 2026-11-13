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

import { createHash } from 'node:crypto'
import { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { initProseMirrorDoc, updateYFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { ServerKit } from '@hcengineering/text'
import {
  Awareness,
  createYjsReferences,
  getEditorContext,
  AgentOperationFailure,
  finalizeAgentOperations,
  indexAgentDocument,
  parseAgentNode,
  prepareAgentOperations,
  resolveAgentTarget
} from '@hcengineering/text-agent'
import type {
  AgentIndex,
  AgentNodeEntry,
  AgentOperation as NativeOperation,
  AgentPolicy,
  AgentReferenceSource,
  AgentScope
} from '@hcengineering/text-agent'
import type {
  AgentNodePage,
  AgentNodeSummary,
  AgentOperation,
  ApplyAgentOpsResponse,
  FindAgentNodesRequest,
  GetAgentOutlineResponse,
  GetAgentSchemaRequest,
  GetAgentSchemaResponse,
  ReadAgentNodeResponse
} from '@hcengineering/collaborator-client'
import { Doc, applyUpdate, encodeStateAsUpdate, encodeStateVector } from 'yjs'

interface DocumentSnapshot {
  state: EditorState
  index: AgentIndex
  scope: AgentScope
  references: AgentReferenceSource
  initial: ReturnType<typeof initProseMirrorDoc>
}

function nativeOperation (op: AgentOperation): NativeOperation {
  return op.op === 'delete_node' ? { op: op.op, ref: op.ref, expectedFingerprint: op.expect.hash } : op
}

function nameDistance (left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 0; i < left.length; i++) {
    let previous = row[0]
    row[0] = i + 1
    for (let j = 0; j < right.length; j++) {
      const above = row[j + 1]
      row[j + 1] = Math.min(above + 1, row[j] + 1, previous + (left[i] === right[j] ? 0 : 1))
      previous = above
    }
  }
  return row[right.length]
}

/** Synchronous editor operations over one live document; owns no persistent document session. */
export class AgentEditor {
  readonly awareness = new Awareness([ServerKit])
  private readonly policy: AgentPolicy

  constructor () {
    this.policy = {
      nodes: Object.fromEntries(
        Object.values(this.awareness.schema.nodes).map((type) => [
          type.name,
          {
            insertable: true,
            deletable: true,
            textEditable: true,
            editableAttrs: Object.keys(type.spec.attrs ?? {})
          }
        ])
      ),
      marks: Object.fromEntries(Object.keys(this.awareness.schema.marks).map((name) => [name, { editable: true }]))
    }
  }

  /** Return plain transport data; metadata and native validators remain owned by Awareness. */
  schema (request: GetAgentSchemaRequest = {}): GetAgentSchemaResponse {
    const model: GetAgentSchemaResponse = JSON.parse(JSON.stringify(getEditorContext(this.awareness)))
    if (request.nodes === undefined && request.marks === undefined) return model
    const select = <T>(definitions: Record<string, T>, names: string[], category: string): Record<string, T> => {
      for (const name of names) {
        if (!Object.hasOwn(definitions, name)) {
          throw new AgentOperationFailure('UNSUPPORTED_SCHEMA', `Unknown ${category} type: ${name}.`)
        }
      }
      return Object.fromEntries(names.map((name) => [name, definitions[name]]))
    }
    return {
      topNode: model.topNode,
      nodes: select(model.nodes, request.nodes ?? [], 'node'),
      marks: select(model.marks, request.marks ?? [], 'mark')
    }
  }

  private capture (document: Doc, docName: string): DocumentSnapshot {
    const field = docName.split('|')[3]
    const scope: AgentScope = {
      document: docName,
      field,
      hash: (value) => createHash('sha256').update(value).digest('hex')
    }
    const temporary = document.share.has(field) ? undefined : new Doc()
    try {
      const source = temporary ?? document
      const fragment = source.getXmlFragment(field)
      if (fragment.length > 0) parseAgentNode(this.awareness, yXmlFragmentToProsemirrorJSON(fragment))
      const initial = initProseMirrorDoc(fragment, this.awareness.schema)
      const references = createYjsReferences(document, initial.mapping, scope)
      const state = EditorState.create({ schema: this.awareness.schema, doc: initial.doc })
      return { initial, scope, references, state, index: indexAgentDocument(state.doc, scope, references) }
    } finally {
      temporary?.destroy()
    }
  }

  private node (current: DocumentSnapshot, ref: string): PMNode {
    const target = resolveAgentTarget(current.index, ref)
    const node = current.state.doc.nodeAt(target.from)
    if (node === null) throw new AgentOperationFailure('STALE_REFERENCE', 'Read the document again.')
    return node
  }

  private summary (current: DocumentSnapshot, entry: AgentNodeEntry): AgentNodeSummary {
    return {
      ref: entry.ref,
      type: entry.type,
      preview: entry.preview,
      hash: entry.fingerprint,
      childCount: this.node(current, entry.ref).childCount
    }
  }

  private page (current: DocumentSnapshot, entries: AgentNodeEntry[], from = 0, limit = 50): AgentNodePage {
    if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new AgentOperationFailure('INVALID_OPERATION', 'Expected from >= 0 and limit between 1 and 200.')
    }
    return {
      total: entries.length,
      from,
      rows: entries.slice(from, from + limit).map((entry) => this.summary(current, entry))
    }
  }

  outline (document: Doc, docName: string, from?: number, limit?: number): GetAgentOutlineResponse {
    const current = this.capture(document, docName)
    return {
      ...this.page(
        current,
        current.index.entries.filter((entry) => entry.path.length === 1),
        from,
        limit
      ),
      typesPresent: [...new Set(current.index.entries.map((entry) => entry.type))].sort()
    }
  }

  find (document: Doc, docName: string, request: Omit<FindAgentNodesRequest, 'document'>): AgentNodePage {
    if (request.text === undefined && request.type === undefined) {
      throw new AgentOperationFailure('INVALID_OPERATION', 'Provide text, type, or both.')
    }
    const requestedType = request.type
    if (requestedType !== undefined && !Object.hasOwn(this.awareness.schema.nodes, requestedType)) {
      const names = Object.keys(this.awareness.schema.nodes)
        .map((name) => ({ name, distance: nameDistance(requestedType.toLowerCase(), name.toLowerCase()) }))
        .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
        .slice(0, 3)
        .map(({ name }) => name)
      throw new AgentOperationFailure(
        'UNSUPPORTED_SCHEMA',
        `Unknown node type: ${request.type}. Closest names: ${names.join(', ')}.`
      )
    }
    const current = this.capture(document, docName)
    const entries = current.index.entries.filter(
      (entry) =>
        (request.type === undefined || entry.type === request.type) &&
        (request.text === undefined || this.node(current, entry.ref).textContent.includes(request.text))
    )
    return this.page(current, entries, request.from, request.limit)
  }

  read (document: Doc, docName: string, ref: string): ReadAgentNodeResponse {
    const current = this.capture(document, docName)
    const target = current.index.entries.find((entry) => entry.ref === ref)
    const node = this.node(current, ref)
    if (target === undefined) throw new AgentOperationFailure('STALE_REFERENCE', 'Read the document again.')
    const children = current.index.entries.filter(
      (entry) =>
        entry.path.length === target.path.length + 1 && target.path.every((index, depth) => entry.path[depth] === index)
    )
    return {
      ref,
      hash: target.fingerprint,
      node: node.toJSON(),
      children: children.map((entry) => this.summary(current, entry))
    }
  }

  /** Stage and commit synchronously so a conversion failure cannot partially modify the live document. */
  apply (document: Doc, docName: string, ops: AgentOperation[], origin: unknown): ApplyAgentOpsResponse {
    let opIndex = 0
    let committing = false
    try {
      if (ops.length === 0) throw new AgentOperationFailure('INVALID_OPERATION', 'At least one operation is required.')
      if (ops.length > 100) throw new AgentOperationFailure('TOO_MANY_OPS', 'At most 100 operations per batch.')
      const native: NativeOperation[] = []
      for (opIndex = 0; opIndex < ops.length; opIndex++) native.push(nativeOperation(ops[opIndex]))
      const current = this.capture(document, docName)
      const prepared = prepareAgentOperations(
        this.awareness,
        current.state,
        native,
        current.scope,
        this.policy,
        current.references
      )
      if (!prepared.ok) {
        return {
          ok: false,
          error: {
            ...prepared.error,
            opIndex: prepared.opIndex,
            retryable: false,
            outcome: 'not_applied'
          }
        }
      }
      const candidate = new Doc({ gc: false })
      try {
        const vector = encodeStateVector(document)
        applyUpdate(candidate, encodeStateAsUpdate(document))
        const fragment = candidate.getXmlFragment(current.scope.field)
        const staged = this.capture(candidate, docName)
        updateYFragment(candidate, fragment, prepared.transaction.doc, staged.initial.meta)
        const verified = this.capture(candidate, docName)
        if (!verified.state.doc.eq(prepared.transaction.doc)) {
          throw new AgentOperationFailure('SCHEMA_INVALID', 'Reconciliation changed the prepared document.')
        }
        finalizeAgentOperations(prepared, verified.index)
        committing = true
        applyUpdate(document, encodeStateAsUpdate(candidate, vector), origin)
        const committed = this.capture(document, docName)
        const results = finalizeAgentOperations(prepared, committed.index).map((result) =>
          result.deleted === true
            ? { opIndex: result.opIndex, deleted: true as const }
            : { opIndex: result.opIndex, ref: result.ref!, hash: result.fingerprint! }
        )
        return { ok: true, results }
      } finally {
        candidate.destroy()
      }
    } catch (error: unknown) {
      if (!committing && error instanceof AgentOperationFailure) {
        return {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            opIndex: Math.max(0, Math.min(opIndex, ops.length - 1)),
            retryable: false,
            outcome: 'not_applied'
          }
        }
      }
      throw error
    }
  }
}
