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

import { dump, JSON_SCHEMA } from 'js-yaml'
import { authoringLayoutPath, decodeAuthoringLayout, encodeAuthoringLayout } from './authoring-layout'
import type { AuthoringNativeDocument, ProcessAuthoringResult } from './authoring'
import { assertTree, fail, list, object, text } from './authoring-validation'
import { createContext } from './dslContext'
import { parseContext } from './utils'
import type { SelectedContext } from './types'
import type { Class, Doc, Hierarchy, ModelDb, Ref } from '@hcengineering/core'

/** Validates native model structure without maintaining operation/property allowlists. */
export function compileAuthoringModel (root: Record<string, unknown>, model?: ModelDb): ProcessAuthoringResult {
  if (root.catalog !== undefined) object(root.catalog, 'catalog')
  if (root.kind !== 'card' && root.kind !== 'process') fail('kind', 'Expected card or process')
  const valueSizes = new Map<object, number>()
  const assertValue = (value: unknown, at: string): number => {
    if (typeof value === 'number' && !Number.isFinite(value)) fail(at, 'Expected a finite number')
    if (value !== null && typeof value === 'object') {
      const size = valueSizes.get(value)
      if (size !== undefined) return size
      if (!Array.isArray(value)) object(value, at)
      let entries = 1
      for (const [key, child] of Object.entries(value)) {
        entries += assertValue(child, `${at}.${key}`)
        if (entries > 1000000) fail(at, 'Expanded model exceeds one million values')
      }
      valueSizes.set(value, entries)
      return entries
    }
    return 1
  }
  assertTree(root)
  assertValue(root, '$')
  let entries: unknown[]
  if (root.model !== undefined) {
    object(root, '$', ['version', 'kind', 'model', 'catalog'])
    entries = list(root.model, 'model')
  } else entries = decodeAuthoringLayout(root, model)
  const ids = new Set<string>()
  const docs = entries.map((value, index): AuthoringNativeDocument => {
    const at = `model[${index}]`
    const doc = object(value, at)
    const id = text(doc._id, `${at}._id`)
    if (ids.has(id)) fail(`${at}._id`, 'Duplicate document identifier')
    ids.add(id)
    text(doc._class, `${at}._class`)
    text(doc.space, `${at}.space`)
    return doc as AuthoringNativeDocument
  })
  const processes = docs.filter((doc) => doc._class === 'process:class:Process')
  if (root.kind === 'process' && processes.length !== 1) {
    fail('model', 'A standalone definition must contain exactly one process')
  }
  if (
    root.kind === 'card' &&
    !docs.some((doc) => doc._class === 'card:class:MasterTag' || doc._class === 'card:class:Tag')
  ) {
    fail('model', 'A card module must contain a card type or tag')
  }
  const byId = new Map(docs.map((doc) => [doc._id, doc]))
  const actionIds = new Set<string>()
  for (const [index, doc] of docs.entries()) {
    const at = root.model === undefined ? authoringLayoutPath(doc) : `model[${index}]`
    if (doc._class === 'process:class:Process') {
      text(doc.name, `${at}.name`)
      text(doc.masterTag, `${at}.masterTag`)
      object(doc.context, `${at}.context`)
      for (const [key, value] of Object.entries(object(doc.requiredSlots ?? {}, `${at}.requiredSlots`))) {
        const slot = object(value, `${at}.requiredSlots.${key}`)
        text(slot.slotKind, `${at}.requiredSlots.${key}.slotKind`)
        text(slot._class, `${at}.requiredSlots.${key}._class`)
        if (slot.slotKind === 'attribute') {
          text(object(slot.type, `${at}.requiredSlots.${key}.type`)._class, `${at}.requiredSlots.${key}.type._class`)
        }
      }
    }
    if (doc._class !== 'process:class:State' && doc._class !== 'process:class:Transition') continue
    const owner = text(doc.process, `${at}.process`)
    if (byId.get(owner)?._class !== 'process:class:Process') fail(`${at}.process`, 'Unknown process reference')
    if (doc._class === 'process:class:State') {
      text(doc.title, `${at}.title`)
      continue
    }
    for (const key of ['from', 'to']) {
      if (key === 'from' && doc.from === null) continue
      const state = byId.get(text(doc[key], `${at}.${key}`))
      if (state?._class !== 'process:class:State' || state.process !== owner) {
        fail(`${at}.${key}`, 'Expected a state belonging to this process')
      }
    }
    text(doc.trigger, `${at}.trigger`)
    object(doc.triggerParams, `${at}.triggerParams`)
    for (const [index, value] of list(doc.actions, `${at}.actions`).entries()) {
      const path =
        root.model === undefined ? `${at}.actions.${String(object(value, at)._id)}` : `${at}.actions[${index}]`
      const action = object(value, path)
      const id = text(action._id, `${path}._id`)
      if (actionIds.has(id) || ids.has(id)) fail(`${path}._id`, 'Duplicate action identifier')
      actionIds.add(id)
      text(action.methodId, `${path}.methodId`)
      object(action.params, `${path}.params`)
      if (action.context != null) text(object(action.context, `${path}.context`)._id, `${path}.context._id`)
      if (action.results !== undefined) list(action.results, `${path}.results`)
    }
  }
  return { kind: root.kind, docs, fields: {} }
}

/** Serializes all native data; newly introduced classes, operations and properties are retained. */
export function exportAuthoringModel (
  documents: readonly unknown[],
  kind: 'card' | 'process',
  catalog?: Record<string, unknown>
): string {
  compileAuthoringModel({ version: 2, kind, model: documents, ...(catalog !== undefined ? { catalog } : {}) })
  const docs = JSON.parse(JSON.stringify(documents)) as AuthoringNativeDocument[]
  return dump(
    { version: 2, kind, ...encodeAuthoringLayout(docs, { catalog }), ...(catalog !== undefined ? { catalog } : {}) },
    { noRefs: true, noCompatMode: true, lineWidth: 120, sortKeys: false, schema: JSON_SCHEMA }
  )
}

/** Rebinds model references and native context expressions, preserving literal text. */
export function remapAuthoringReferences (
  documents: readonly AuthoringNativeDocument[],
  mapping: ReadonlyMap<string, string>,
  isLiteral: (doc: AuthoringNativeDocument, path: readonly string[]) => boolean = () => false
): AuthoringNativeDocument[] {
  const reference = (value: string): string => mapping.get(value) ?? value
  const selector = (value: string): string => mapping.get(value) ?? value.split('.').map(reference).join('.')
  const expression = (source: string): string => {
    if (!source.startsWith('${') || !source.endsWith('}')) return source
    const context = parseContext(source)
    if (context === undefined) return source
    const updated = remapContext(context)
    if (JSON.stringify(updated) === JSON.stringify(context)) return source
    return source.startsWith('${{') ? '${' + JSON.stringify(updated) + '}' : createContext(updated)
  }
  const nestedExpressions = (value: unknown, literal = false): unknown => {
    if (typeof value === 'string') {
      const decoded = expression(value)
      return decoded !== value ? decoded : literal ? value : selector(value)
    }
    if (Array.isArray(value)) return value.map((item) => nestedExpressions(item, literal))
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, nestedExpressions(item, literal || literalKeys.has(key))])
      )
    }
    return value
  }
  const remapContext = (context: SelectedContext): SelectedContext => {
    const updated = JSON.parse(JSON.stringify(context)) as SelectedContext
    updated.key = selector(updated.key)
    if (updated.type === 'context' || updated.type === 'userRequest') {
      updated.id = reference(updated.id) as typeof updated.id
    }
    if (updated.type === 'nested') updated.path = selector(updated.path)
    if (updated.type === 'relation') updated.association = reference(updated.association) as typeof updated.association
    if (updated.type === 'userRequest') {
      updated._class = reference(updated._class) as typeof updated._class
      if (updated.selectionSpace !== undefined) updated.selectionSpace = expression(updated.selectionSpace)
    }
    if (updated.type === 'function') {
      updated.func = reference(updated.func) as typeof updated.func
      updated.props = nestedExpressions(updated.props) as typeof updated.props
    }
    if (updated.sourceFunction !== undefined) {
      updated.sourceFunction.func = reference(updated.sourceFunction.func) as typeof updated.sourceFunction.func
      updated.sourceFunction.props = nestedExpressions(
        updated.sourceFunction.props
      ) as typeof updated.sourceFunction.props
    }
    for (const func of updated.functions ?? []) {
      func.func = reference(func.func) as typeof func.func
      func.props = nestedExpressions(func.props) as typeof func.props
    }
    return updated
  }
  const literalKeys = new Set(['name', 'title', 'label', 'description', 'rank', 'enumValues', 'eventType', 'prefix'])
  const visit = (value: unknown, doc: AuthoringNativeDocument, path: string[], inheritedLiteral = false): unknown => {
    const key = path[path.length - 1]
    const literal = inheritedLiteral || literalKeys.has(key) || isLiteral(doc, path)
    if (typeof value === 'string') {
      // A symbolic field name can equal its definition id. Keep it consistent with
      // selectors when cloning that id, rather than treating it as display text.
      if (doc._class === 'core:class:Attribute' && path.length === 1 && key === 'name') return reference(value)
      if (inheritedLiteral || (literal && !path.includes('params') && !path.includes('triggerParams'))) return value
      const decoded = expression(value)
      if (decoded !== value) return decoded
      return literal ? value : selector(value)
    }
    if (Array.isArray(value)) return value.map((item, index) => visit(item, doc, [...path, String(index)], literal))
    if (value !== null && typeof value === 'object') {
      const data = value as Record<string, unknown>
      if (
        typeof data.key === 'string' &&
        typeof data.type === 'string' &&
        ['attribute', 'context', 'nested', 'relation', 'userRequest', 'function', 'const'].includes(data.type)
      ) {
        return remapContext(data as unknown as SelectedContext)
      }
      const namedKeys =
        doc._class === 'process:class:Process' && path.length === 1 && (key === 'requiredSlots' || key === 'bindings')
      return Object.fromEntries(
        Object.entries(data).map(([key, item]) => [
          literal || namedKeys ? key : selector(key),
          visit(item, doc, [...path, key], literal)
        ])
      )
    }
    return value
  }
  return documents.map((doc) => visit(doc, doc, []) as AuthoringNativeDocument)
}

/** Collects identities owned by a process graph, including published results and user requests. */
export function getAuthoringProcessIdentities (documents: readonly AuthoringNativeDocument[]): Set<string> {
  const ids = new Set<string>()
  const visited = new Set<object>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const context = parseContext(value)
      if (context !== undefined) visit(context)
    } else if (value !== null && typeof value === 'object') {
      if (visited.has(value)) return
      visited.add(value)
      const data = value as Record<string, unknown>
      if (data.type === 'userRequest' && typeof data.id === 'string') ids.add(data.id)
      for (const [key, child] of Object.entries(data)) {
        if (data.type !== 'const' || key !== 'value') visit(child)
      }
    }
  }
  for (const doc of documents) {
    if (['process:class:Process', 'process:class:State', 'process:class:Transition'].includes(doc._class)) {
      ids.add(doc._id)
    }
    if (doc._class === 'process:class:Process') {
      for (const key of Object.keys(object(doc.context, 'context'))) ids.add(key)
    }
    if (doc._class === 'process:class:Transition') {
      for (const action of list(doc.actions, 'actions')) {
        const data = object(action, 'action')
        ids.add(text(data._id, 'action._id'))
        if (data.context != null) ids.add(text(object(data.context, 'action.context')._id, 'action.context._id'))
        for (const result of list(data.results ?? [], 'action.results')) {
          ids.add(text(object(result, 'result')._id, 'result._id'))
        }
      }
    }
    visit(doc)
  }
  return ids
}

/** Lists the installed contracts for authors; catalogs never install or redefine operations. */
export function getAuthoringCatalog (model: ModelDb): Record<string, unknown> {
  const internal = new Set([
    '_id',
    '_class',
    'space',
    'createdOn',
    'modifiedOn',
    'createdBy',
    'modifiedBy',
    'editor',
    'presenter',
    'icon',
    'checkFunction'
  ])
  const definitions = (clazz: string): Record<string, unknown> =>
    Object.fromEntries(
      model
        .findAllSync(clazz as Ref<Class<Doc>>, {})
        .map((doc) => [doc._id, Object.fromEntries(Object.entries(doc).filter(([key]) => !internal.has(key)))])
    )
  return {
    methods: definitions('process:class:Method'),
    triggers: definitions('process:class:Trigger'),
    functions: definitions('process:class:ProcessFunction')
  }
}

/** Resolves operations through the installed model before applying a full definition. */
export function validateAuthoringModelOperations (
  documents: readonly AuthoringNativeDocument[],
  model: ModelDb,
  hierarchy: Hierarchy
): void {
  const known = (id: string, clazz: string, path: string): void => {
    const doc = model.findObject(id as Ref<Doc>)
    if (doc === undefined || (doc._class !== clazz && !hierarchy.isDerived(doc._class, clazz as Ref<Class<Doc>>))) {
      fail(path, `Operation ${id} is not registered in the destination model`)
    }
  }
  for (const doc of documents) {
    if (doc._class !== 'process:class:Transition') continue
    const path = authoringLayoutPath(doc)
    known(String(doc.trigger), 'process:class:Trigger', `${path}.on`)
    for (const value of list(doc.actions, `${path}.actions`)) {
      const action = object(value, 'action')
      known(String(action.methodId), 'process:class:Method', `${path}.actions.${String(action._id)}.method`)
    }
  }
  const checkContext = (context: SelectedContext, path: string): void => {
    if (context.type === 'function') known(context.func, 'process:class:ProcessFunction', path)
    if (context.sourceFunction !== undefined) known(context.sourceFunction.func, 'process:class:ProcessFunction', path)
    for (const func of context.functions ?? []) known(func.func, 'process:class:ProcessFunction', path)
  }
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const context = parseContext(value)
      if (context !== undefined) {
        checkContext(context, path)
        visit(context, path)
      }
    } else if (value !== null && typeof value === 'object') {
      const data = value as Record<string, unknown>
      if (
        typeof data.key === 'string' &&
        typeof data.type === 'string' &&
        ['attribute', 'context', 'nested', 'relation', 'userRequest', 'function', 'const'].includes(data.type)
      ) {
        checkContext(data as unknown as SelectedContext, path)
      }
      for (const [key, child] of Object.entries(data)) {
        if ((data.type === 'const' && key === 'value') || key === 'fallbackValue') continue
        visit(child, `${path}.${key}`)
      }
    }
  }
  for (const doc of documents) visit(doc, authoringLayoutPath(doc))
}
