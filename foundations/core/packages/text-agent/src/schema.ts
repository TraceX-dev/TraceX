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

import { getExtensionField, getSchemaByResolvedExtensions, resolveExtensions } from '@tiptap/core'
import type { Extensions, JSONContent } from '@tiptap/core'
import { Schema } from '@tiptap/pm/model'
import type { AttributeSpec, ContentMatch, NodeType } from '@tiptap/pm/model'

// Schema awareness editor extension

export interface AttributeAwareness {
  description?: string
  access?: 'readwrite' | 'readonly'
  hidden?: boolean
}

export interface SchemaAwareness {
  label?: string
  description?: string
  attributes?: Record<string, AttributeAwareness>
  example?: JSONContent
}

export interface SchemaAwarenessContext<Options, Storage> {
  name: string
  options: Options
  storage: Storage
  schema: Schema
  parent: (() => SchemaAwareness) | null
}

export type AddSchemaAwareness<Options = unknown, Storage = unknown> = (
  this: SchemaAwarenessContext<Options, Storage>
) => SchemaAwareness

declare module '@tiptap/core' {
  interface NodeConfig<Options, Storage> {
    addSchemaAwareness?: AddSchemaAwareness<Options, Storage>
  }
  interface MarkConfig<Options, Storage> {
    addSchemaAwareness?: AddSchemaAwareness<Options, Storage>
  }
}

// Schema awareness processing

export interface AttributeSchema extends AttributeAwareness {
  name: string
  type: string | string[]
  required: boolean
  nullable: boolean
  default?: unknown
  enum?: readonly string[]
}

export interface NodeSchema {
  name: string
  label?: string
  description?: string
  type: 'node'
  attributes: Record<string, AttributeSchema>
  content: string
  allowedChildren: string[]
  group?: string
  inline: boolean
  marks: string[]
  example?: JSONContent
}

export interface MarkSchema {
  name: string
  label?: string
  description?: string
  type: 'mark'
  attributes: Record<string, AttributeSchema>
  group?: string
  excludes: string[]
}

export interface EditorContext {
  topNode: string
  nodes: Record<string, NodeSchema>
  marks: Record<string, MarkSchema>
}

function attributeType (attr: AttributeSpec): Pick<AttributeSchema, 'type' | 'nullable' | 'enum'> {
  if (typeof attr.validate === 'string') {
    const types = attr.validate.split('|')
    const values = types.filter((type) => type !== 'null' && type !== 'undefined')
    return {
      type: values.length === 0 ? 'unknown' : values.length === 1 ? values[0] : values,
      nullable: types.includes('null')
    }
  }
  if (typeof attr.validate === 'function') {
    const validate: typeof attr.validate & { values?: readonly string[], nullable?: boolean } = attr.validate
    if (validate.values !== undefined) {
      return { type: 'string', nullable: validate.nullable === true, enum: validate.values }
    }
  }
  return {
    type: attr.default == null ? 'unknown' : Array.isArray(attr.default) ? 'array' : typeof attr.default,
    nullable: attr.default === null
  }
}

function describeAttributes (
  attrs: Record<string, AttributeSpec> = {},
  awareness: SchemaAwareness
): Record<string, AttributeSchema> {
  return Object.fromEntries(
    Object.entries(attrs).map(([key, attr]) => {
      const metadata = awareness.attributes?.[key]
      const inferred = attributeType(attr)
      const value: AttributeSchema = {
        name: key,
        description: metadata?.description,
        ...inferred,
        required: !Object.hasOwn(attr, 'default'),
        ...(Object.hasOwn(attr, 'default') ? { default: attr.default } : {}),
        ...metadata
      }
      return [key, value]
    })
  )
}

function checkedAttributes (attrs: Record<string, AttributeSpec> = {}): Record<string, AttributeSpec> {
  return Object.fromEntries(
    Object.entries(attrs).map(([name, attr]) => {
      if (attr.validate !== undefined || attr.default == null) return [name, attr]
      const spec: AttributeSpec = {
        ...attr,
        validate: Array.isArray(attr.default)
          ? (value: unknown) => {
              if (!Array.isArray(value)) throw new RangeError(`${name}: expected an array.`)
            }
          : typeof attr.default
      }
      return [name, spec]
    })
  )
}

/** Own the compiled schema and extension metadata for one editor configuration. */
export class Awareness {
  private readonly byName = new Map<string, SchemaAwareness>()
  readonly schema: Schema

  constructor (extensions: Extensions) {
    const resolved = resolveExtensions(extensions)
    const native = getSchemaByResolvedExtensions(resolved)

    this.schema = new Schema({
      topNode: native.topNodeType.name,
      nodes: Object.fromEntries(
        Object.values(native.nodes).map((type) => [
          type.name,
          {
            ...type.spec,
            attrs: checkedAttributes(type.spec.attrs)
          }
        ])
      ),
      marks: Object.fromEntries(
        Object.values(native.marks).map((type) => [
          type.name,
          {
            ...type.spec,
            attrs: checkedAttributes(type.spec.attrs)
          }
        ])
      )
    })

    for (const extension of resolved) {
      if (extension.type === 'extension') continue

      const hook = getExtensionField<AddSchemaAwareness>(extension, 'addSchemaAwareness', {
        name: extension.name,
        options: extension.options,
        storage: extension.storage,
        schema: this.schema
      })
      const awareness = hook?.()
      if (awareness === undefined) continue

      const type = extension.type === 'node' ? this.schema.nodes[extension.name] : this.schema.marks[extension.name]
      for (const name of Object.keys(awareness.attributes ?? {})) {
        if (!Object.hasOwn(type.spec.attrs ?? {}, name)) {
          throw new RangeError(`${extension.name}: schema awareness describes unknown attribute ${name}.`)
        }
      }

      if (awareness.example !== undefined) {
        if (extension.type !== 'node' || awareness.example.type !== extension.name) {
          throw new RangeError(`${extension.name}: example must use its owning node type.`)
        }
        this.schema.nodeFromJSON(awareness.example).check()
      }
      this.byName.set(extension.name, awareness)
    }
  }

  /** Return the owning node or mark description, if its extension provides one. */
  of (typeName: string): SchemaAwareness | undefined {
    return this.byName.get(typeName)
  }

  /** Return descriptive metadata and agent permissions for a native attribute. */
  attr (typeName: string, attr: string): AttributeAwareness | undefined {
    return this.byName.get(typeName)?.attributes?.[attr]
  }
}

function allowedChildren (type: NodeType): string[] {
  const pending: ContentMatch[] = [type.contentMatch]
  const visited = new Set<ContentMatch>()
  const names = new Set<string>()
  while (pending.length > 0) {
    const match = pending.pop()
    if (match === undefined || visited.has(match)) continue
    visited.add(match)
    for (let i = 0; i < match.edgeCount; i++) {
      const edge = match.edge(i)
      names.add(edge.type.name)
      pending.push(edge.next)
    }
  }
  return [...names]
}

/** Describe the compiled schema and metadata without constructing another schema or an Editor. */
export function getEditorContext (source: Awareness): EditorContext {
  const { schema } = source
  const marks = Object.values(schema.marks)
  return {
    topNode: schema.topNodeType.name,
    nodes: Object.fromEntries(
      Object.values(schema.nodes).map((type) => {
        const awareness = source.of(type.name) ?? {}
        const value: NodeSchema = {
          name: type.name,
          label: awareness.label,
          description: awareness.description,
          type: 'node',
          attributes: describeAttributes(type.spec.attrs, awareness),
          content: type.spec.content ?? '',
          allowedChildren: allowedChildren(type),
          group: type.spec.group,
          inline: type.isInline,
          marks: marks.filter((mark) => type.allowsMarkType(mark)).map((mark) => mark.name),
          example: awareness.example
        }
        return [type.name, value]
      })
    ),
    marks: Object.fromEntries(
      marks.map((type) => {
        const awareness = source.of(type.name) ?? {}
        const value: MarkSchema = {
          name: type.name,
          label: awareness.label,
          description: awareness.description,
          type: 'mark',
          attributes: describeAttributes(type.spec.attrs, awareness),
          group: type.spec.group,
          excludes: marks.filter((other) => type.excludes(other)).map((other) => other.name)
        }
        return [type.name, value]
      })
    )
  }
}
