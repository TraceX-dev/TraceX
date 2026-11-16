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

import type { AttributeSpec, MarkType, Node as PMNode, NodeType } from '@tiptap/pm/model'
import type { AgentErrorCode } from './types'
import type { Awareness } from '../schema'

/** Read attribute permissions from the same owner as the native schema. */
export function attributeReadonly (awareness: Awareness, type: NodeType | MarkType, name: string): boolean {
  const attribute = awareness.attr(type.name, name)
  return attribute?.access === 'readonly' || attribute?.hidden === true
}

export class AgentOperationFailure extends Error {
  constructor (
    readonly code: AgentErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AgentOperationFailure'
  }
}

export function own<T> (record: Readonly<Record<string, T>>, name: string): T | undefined {
  return Object.hasOwn(record, name) ? record[name] : undefined
}

function record (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertAttrs (value: unknown, attrs: Readonly<Record<string, AttributeSpec>>, path: string): void {
  if (value === undefined) return
  if (!record(value)) throw new AgentOperationFailure('SCHEMA_INVALID', `${path}: expected an attribute object.`)
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(attrs, name)) {
      throw new AgentOperationFailure('UNSUPPORTED_SCHEMA', `${path}: unknown attribute ${name}.`)
    }
  }
}

/** Validate raw JSON before ProseMirror can silently discard unknown attributes. */
export function parseAgentNode (awareness: Awareness, json: unknown, insertion = false): PMNode {
  const { schema } = awareness
  const assertWritable = (attrs: unknown, type: NodeType | MarkType): void => {
    if (!insertion || !record(attrs)) return
    for (const name of Object.keys(attrs)) {
      if (attributeReadonly(awareness, type, name)) {
        throw new AgentOperationFailure('FORBIDDEN', `Readonly attribute ${name} cannot be supplied during insertion.`)
      }
    }
  }
  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 100) throw new AgentOperationFailure('SCHEMA_INVALID', 'Maximum node depth is 100.')
    if (!record(value) || typeof value.type !== 'string') {
      throw new AgentOperationFailure('SCHEMA_INVALID', `${path}: expected a typed node.`)
    }
    const type = own(schema.nodes, value.type)
    if (type === undefined) {
      throw new AgentOperationFailure('UNSUPPORTED_SCHEMA', `${path}: unknown node ${value.type}.`)
    }
    const keys = new Set(['type', 'attrs', 'text', 'marks', 'content'])
    if (Object.keys(value).some((key) => !keys.has(key))) {
      throw new AgentOperationFailure('UNSUPPORTED_SCHEMA', `${path}: unknown node property.`)
    }
    assertAttrs(value.attrs, type.spec.attrs ?? {}, path)
    assertWritable(value.attrs, type)
    if (value.text !== undefined && (!type.isText || typeof value.text !== 'string')) {
      throw new AgentOperationFailure('SCHEMA_INVALID', `${path}: unexpected text.`)
    }
    if (value.marks !== undefined) {
      if (!Array.isArray(value.marks)) throw new AgentOperationFailure('SCHEMA_INVALID', `${path}: invalid marks.`)
      for (const mark of value.marks) {
        if (!record(mark) || typeof mark.type !== 'string') {
          throw new AgentOperationFailure('SCHEMA_INVALID', `${path}: invalid mark.`)
        }
        const markType = own(schema.marks, mark.type)
        if (markType === undefined) {
          throw new AgentOperationFailure('UNSUPPORTED_SCHEMA', `${path}: unknown mark ${mark.type}.`)
        }
        if (Object.keys(mark).some((key) => key !== 'type' && key !== 'attrs')) {
          throw new AgentOperationFailure('UNSUPPORTED_SCHEMA', `${path}: unknown mark property.`)
        }
        assertAttrs(mark.attrs, markType.spec.attrs ?? {}, `${path}.${mark.type}`)
        assertWritable(mark.attrs, markType)
      }
    }
    if (value.content !== undefined) {
      if (!Array.isArray(value.content) || type.isText || (type.isLeaf && value.content.length > 0)) {
        throw new AgentOperationFailure('SCHEMA_INVALID', `${path}: invalid content.`)
      }
      value.content.forEach((child, index) => {
        visit(child, `${path}/${index}`, depth + 1)
      })
    }
  }
  visit(json, 'root', 0)
  try {
    const node = schema.nodeFromJSON(json)
    const checkContent = (node: PMNode): void => {
      if (!node.type.validContent(node.content)) {
        throw new RangeError(
          `Invalid content in ${node.type.name}. Expected: ${node.type.spec.content ?? '(no children)'}. ` +
            'Use collab.schema with this node type for allowed children and JSON examples.'
        )
      }
      node.forEach(checkContent)
    }
    checkContent(node)
    node.check()
    return node
  } catch (error: unknown) {
    throw new AgentOperationFailure('SCHEMA_INVALID', error instanceof Error ? error.message : 'Invalid node JSON.')
  }
}
