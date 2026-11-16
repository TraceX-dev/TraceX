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

import type { Node as PMNode } from '@tiptap/pm/model'
import { AgentOperationFailure } from './schema'
import type { AgentReferenceSource, AgentScope } from './types'

export interface AgentNodeEntry {
  ref: string
  type: string
  path: number[]
  preview: string
  fingerprint: string
}

export interface AgentTarget {
  from: number
  to: number
  type: string
  deleted: boolean
}

export interface AgentIndex {
  doc: PMNode
  entries: AgentNodeEntry[]
  targets: Map<string, AgentTarget[]>
}

/** Stable JSON encoding; rejects values that cannot be represented losslessly in JSON. */
export function canonicalAgentJSON (value: unknown): string {
  const ancestors = new Set<object>()
  const encode = (value: unknown, depth: number): string => {
    if (depth > 200) throw new AgentOperationFailure('SCHEMA_INVALID', 'Maximum JSON depth exceeded.')
    if (value === null) return 'null'
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
    if (typeof value !== 'object' || value === null || ancestors.has(value)) {
      throw new AgentOperationFailure('SCHEMA_INVALID', 'Content must contain only acyclic JSON values.')
    }
    ancestors.add(value)
    let encoded: string
    if (Array.isArray(value)) {
      encoded = `[${Array.from(value, (item) => encode(item, depth + 1)).join(',')}]`
    } else {
      const prototype: unknown = Object.getPrototypeOf(value)
      if (prototype !== null && prototype !== Object.prototype) {
        throw new AgentOperationFailure('SCHEMA_INVALID', 'Content must contain only plain JSON objects.')
      }
      const values = value as Record<string, unknown>
      encoded = `{${Object.keys(values)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${encode(values[key], depth + 1)}`)
        .join(',')}}`
    }
    ancestors.delete(value)
    return encoded
  }
  return encode(value, 0)
}

/** Hash the entire persisted subtree, including marks, attributes and embedded objects. */
export function fingerprintAgentNode (node: PMNode, scope: AgentScope): string {
  return scope.hash(canonicalAgentJSON([scope.document, scope.field, node.toJSON()]))
}

/** Build an index from a live identity adapter. Paths are display labels, never addresses. */
export function indexAgentDocument (doc: PMNode, scope: AgentScope, references: AgentReferenceSource): AgentIndex {
  if (scope.document.length === 0 || scope.field.length === 0) {
    throw new AgentOperationFailure('INVALID_OPERATION', 'Document and field scope are required.')
  }
  if (references.document !== scope.document || references.field !== scope.field) {
    throw new AgentOperationFailure('STALE_REFERENCE', 'Reference source belongs to another document or field.')
  }
  const entries: AgentNodeEntry[] = []
  const targets = new Map<string, AgentTarget[]>()
  const visit = (parent: PMNode, start: number, path: number[]): void => {
    parent.forEach((node, offset, index) => {
      if (node.isText) return
      const nodePath = [...path, index]
      const from = start + offset
      const ref = references.refForNode(node)
      const target: AgentTarget = { from, to: from + node.nodeSize, type: node.type.name, deleted: false }
      entries.push({
        ref,
        type: node.type.name,
        path: nodePath,
        preview: node.textContent.slice(0, 160),
        fingerprint: fingerprintAgentNode(node, scope)
      })
      const candidates = targets.get(ref) ?? []
      candidates.push(target)
      targets.set(ref, candidates)
      if (!node.isLeaf) visit(node, from + 1, nodePath)
    })
  }
  visit(doc, 0, [])
  return { doc, entries, targets }
}

export function resolveAgentTarget (index: AgentIndex, ref: string): AgentTarget {
  const candidates = index.targets.get(ref)
  if (candidates === undefined || candidates.length === 0) {
    throw new AgentOperationFailure(
      'STALE_REFERENCE',
      'The handle no longer resolves in the live tree. Read the document again.'
    )
  }
  if (candidates.length !== 1) {
    throw new AgentOperationFailure('AMBIGUOUS_REF', 'The adapter returned the same handle for multiple nodes.')
  }
  return { ...candidates[0] }
}
