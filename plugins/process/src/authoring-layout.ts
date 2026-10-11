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

import { makeRank } from '@hcengineering/rank'
import type { ModelDb } from '@hcengineering/core'
import type { AuthoringNativeDocument } from './authoring'
import { fail, object, text } from './authoring-validation'
import { compactAuthoringOutput, publishAuthoringOutput, type AuthoringOutputEnvironment } from './authoring-outputs'
import {
  authoringClassName as className,
  authoringReferenceValues,
  authoringSlotReferences,
  type AuthoringReferenceScope
} from './authoring-references'
import {
  compactAuthoringResults,
  decodeAuthoringType,
  encodeAuthoringType,
  publishAuthoringResults
} from './authoring-results'
import { authoringOperationContract, validateAuthoringParameters } from './authoring-contracts'

// These aliases describe document layout, never the available engine operations.
const SECTIONS: Record<string, string> = {
  cardTypes: 'card:class:MasterTag',
  tags: 'card:class:Tag',
  fields: 'core:class:Attribute',
  enums: 'core:class:Enum',
  views: 'view:class:Viewlet',
  roles: 'card:class:Role',
  relations: 'core:class:Association',
  permissions: 'core:class:ClassPermission',
  attributePermissions: 'core:class:AttributePermission',
  sequences: 'core:class:CustomSequence'
}
const PROCESS = 'process:class:Process'
const STATE = 'process:class:State'
const TRANSITION = 'process:class:Transition'
const MODEL_SPACE = 'core:space:Model'
const RANKED = new Set([PROCESS, STATE, TRANSITION, SECTIONS.fields, SECTIONS.cardTypes, SECTIONS.tags])

/** Returns the authoring block path for a compiled native document. */
export function authoringLayoutPath (doc: AuthoringNativeDocument): string {
  if (doc._class === PROCESS) return `processes.${doc._id}`
  if (doc._class === STATE) return `processes.${String(doc.process)}.states.${doc._id}`
  if (doc._class === TRANSITION) {
    return `processes.${String(doc.process)}.${doc.from === null ? 'start' : `states.${String(doc.from)}.transitions`}.${doc._id}`
  }
  return `${Object.entries(SECTIONS).find(([, clazz]) => clazz === doc._class)?.[0] ?? `documents.${doc._class}`}.${doc._id}`
}

/** Renames structural metadata only; operation params, queries and literal values stay opaque. */
function metadata (value: unknown, decode: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => metadata(item, decode))
  if (value === null || typeof value !== 'object') return value
  const data = object(value, 'metadata')
  const aliases = { _class: 'class', _id: 'id', slotKind: 'kind' }
  const renamed = rename(data, aliases, decode)
  return Object.fromEntries(
    Object.entries(renamed).map(([key, child]) => [
      key,
      key === (decode ? '_class' : 'class')
        ? className(child, decode)
        : ['value', 'defaultValue', 'params', 'triggerParams', 'bindings', 'native'].includes(key)
          ? child
          : metadata(child, decode)
    ])
  )
}

/** A native escape preserves future properties which collide with authoring layout names. */
function rename (
  data: Record<string, unknown>,
  aliases: Record<string, string>,
  decode: boolean
): Record<string, unknown> {
  if (decode) {
    const result = { ...object(data.native ?? {}, 'native') }
    for (const [key, value] of Object.entries(data)) {
      if (key === 'native') continue
      const target = Object.entries(aliases).find(([, alias]) => alias === key)?.[0] ?? key
      if (Object.prototype.hasOwnProperty.call(result, target)) fail(key, 'Property conflicts with native data')
      result[target] = value
    }
    return result
  }
  const result: Record<string, unknown> = {}
  const native: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === 'native' || Object.values(aliases).includes(key)) native[key] = value
    else result[aliases[key] ?? key] = value
  }
  if (Object.keys(native).length > 0) result.native = native
  return result
}

function ordered (docs: readonly AuthoringNativeDocument[]): AuthoringNativeDocument[] {
  return [...docs].sort((a, b) =>
    typeof a.rank === 'string' && typeof b.rank === 'string' ? a.rank.localeCompare(b.rank) : 0
  )
}

function documentMetadata (data: Record<string, unknown>, decode: boolean, clazz: string, path = clazz): void {
  const type = (value: unknown, at: string): unknown => {
    const candidate = decode ? value : encodeAuthoringType(value)
    const short =
      typeof candidate === 'string' ||
      (candidate !== null &&
        typeof candidate === 'object' &&
        Object.keys(candidate).length === 1 &&
        ['array', 'ref', 'enum'].some((key) => Object.prototype.hasOwnProperty.call(candidate, key)))
    return short ? (decode ? decodeAuthoringType(candidate, at) : candidate) : metadata(value, decode)
  }
  for (const key of clazz === PROCESS ? ['context', decode ? 'requiredSlots' : 'slots'] : []) {
    if (data[key] !== undefined) {
      data[key] = Object.fromEntries(
        Object.entries(object(data[key], key)).map(([name, value]) => {
          const entry = metadata(value, decode) as Record<string, unknown>
          const original = object(value, key)
          if (original.type !== undefined) entry.type = type(original.type, `${path}.${key}.${name}.type`)
          if (key === (decode ? 'requiredSlots' : 'slots')) {
            if (decode) {
              if (entry.slotKind === undefined && entry.type !== undefined) entry.slotKind = 'attribute'
              if (entry.slotKind === 'attribute') entry._class ??= 'core:class:Attribute'
            } else if (entry.kind === 'attribute' && entry.class === 'core.Attribute') {
              delete entry.kind
              delete entry.class
            }
          }
          return [name, entry]
        })
      )
    }
  }
  for (const key of clazz === PROCESS ? ['resultType'] : clazz === SECTIONS.fields ? ['type'] : []) {
    if (data[key] !== undefined) data[key] = type(data[key], `${path}.${key}`)
  }
}

function encodeDocument (doc: AuthoringNativeDocument, aliases: Record<string, string> = {}): Record<string, unknown> {
  const { _id, _class, space, rank, ...properties } = doc
  if (space !== MODEL_SPACE) properties.space = space
  if (rank !== undefined && !RANKED.has(_class)) properties.rank = rank
  // Layout names are reserved; same-named native extensions go in the escape.
  const data = rename(properties, aliases, false)
  documentMetadata(data, false, _class)
  return data
}

function encodeTransition (
  doc: AuthoringNativeDocument,
  scope: AuthoringReferenceScope,
  outputs: ReadonlyMap<string, unknown>,
  results: ReadonlyMap<string, Record<string, unknown>>
): Record<string, unknown> {
  const { process, from, trigger, triggerParams, actions, ...rest } = doc
  const data = encodeDocument(rest, { on: 'on', actions: 'actions' })
  const name = String(trigger).replace(/^process:trigger:/, '')
  data.on =
    Object.keys(object(triggerParams, 'triggerParams')).length === 0
      ? name
      : { [name]: authoringReferenceValues(triggerParams, false, scope, 'on') }
  data.actions = Object.fromEntries(
    (actions as Array<Record<string, unknown>>).map((action) => {
      const { _id, ...properties } = action
      const step = rename(properties, { methodId: 'method', as: 'as' }, false)
      step.method = String(step.method).replace(/^process:method:/, '')
      const published = outputs.get(String(_id))
      if (published !== undefined) {
        step.as = typeof published === 'string' ? published : { ...object(published, 'as') }
        if (typeof step.as !== 'string') {
          const data = step.as as Record<string, unknown>
          if (data.class !== undefined) {
            data.class = className(authoringSlotReferences(data.class, false, scope, 'as.class'), false)
          }
        }
        delete step.context
      } else if (step.context === null) delete step.context
      else if (step.context !== undefined) step.context = metadata(step.context, false)
      const collected = results.get(String(_id))
      if (collected !== undefined) {
        step.results = Object.fromEntries(
          Object.entries(collected).map(([id, value]) => {
            const data = { ...object(value, 'result') }
            for (const key of ['field', 'selectionSpace', 'excludeRelation']) {
              if (data[key] !== undefined) {
                data[key] = authoringReferenceValues(data[key], false, scope, `results.${id}.${key}`)
              }
            }
            data.type = authoringSlotReferences(data.type, false, scope, `results.${id}.type`)
            return [id, data]
          })
        )
      } else if (step.results !== undefined) step.results = metadata(step.results, false)
      step.params = authoringReferenceValues(step.params, false, scope, 'params')
      if (Object.keys(object(step.params, 'params')).length === 0) delete step.params
      return [String(_id), step]
    })
  )
  if (Object.keys(data.actions as object).length === 0) delete data.actions
  return data
}

/** Groups native documents into named processes, states, transitions and model sections. */
export function encodeAuthoringLayout (
  docs: readonly AuthoringNativeDocument[],
  environment: AuthoringOutputEnvironment = {}
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [section, clazz] of Object.entries(SECTIONS)) {
    const entries = ordered(docs.filter((doc) => doc._class === clazz))
    if (entries.length > 0) result[section] = Object.fromEntries(entries.map((doc) => [doc._id, encodeDocument(doc)]))
  }
  const processes = ordered(docs.filter((doc) => doc._class === PROCESS))
  if (processes.length > 0) {
    result.processes = Object.fromEntries(
      processes.map((proc) => {
        const data = encodeDocument(proc, { name: 'label', requiredSlots: 'slots', states: 'states', start: 'start' })
        const contexts = object(proc.context, 'context')
        const remaining = { ...contexts }
        const scope: AuthoringReferenceScope = {
          slots: object(proc.requiredSlots ?? {}, 'slots'),
          contexts,
          environment
        }
        const outputs = new Map<string, unknown>()
        const results = new Map<string, Record<string, unknown>>()
        const states = ordered(docs.filter((doc) => doc._class === STATE && doc.process === proc._id))
        const transitions = ordered(docs.filter((doc) => doc._class === TRANSITION && doc.process === proc._id))
        const start = transitions.filter((doc) => doc.from === null)
        const sequence = [...start, ...states.flatMap((state) => transitions.filter((doc) => doc.from === state._id))]
        for (const transition of sequence) {
          for (const action of transition.actions as Array<Record<string, unknown>>) {
            const output = compactAuthoringOutput(action, transition._id, contexts, environment, remaining)
            if (output !== undefined) outputs.set(String(action._id), output)
            const collected = compactAuthoringResults(action, transition._id, contexts, remaining)
            if (collected !== undefined) results.set(String(action._id), collected)
          }
        }
        let index = Math.max(0, ...Object.values(remaining).map((value) => Number(object(value, 'context').index) || 0))
        for (const transition of sequence) {
          for (const action of transition.actions as Array<Record<string, unknown>>) {
            const key = String(action._id)
            const values = [...(outputs.has(key) ? [outputs.get(key)] : []), ...Object.values(results.get(key) ?? {})]
            for (const output of values) {
              const data = object(output, 'output')
              const order = Number(data.order)
              if (order === index + 1) delete data.order
              index = Math.max(index, order)
              if (output === outputs.get(key) && Object.keys(data).length === 1) outputs.set(key, data.key)
            }
          }
        }
        data.context = Object.fromEntries(
          Object.entries(remaining).map(([key, value]) => [key, metadata(value, false)])
        )
        if (data.slots !== undefined) data.slots = authoringSlotReferences(data.slots, false, scope, 'slots')
        data.masterTag = authoringSlotReferences(data.masterTag, false, scope, 'masterTag')
        if (data.masterTag === '__MASTER_TAG__') delete data.masterTag
        if (Object.keys(object(data.context, 'context')).length === 0) delete data.context
        if (start.length > 0) {
          data.start = Object.fromEntries(start.map((doc) => [doc._id, encodeTransition(doc, scope, outputs, results)]))
        }
        data.states = Object.fromEntries(
          states.map((state) => {
            const { process, ...properties } = state
            const value = encodeDocument(properties, {
              title: 'label',
              transitions: 'transitions'
            })
            const outgoing = transitions.filter((doc) => doc.from === state._id)
            if (outgoing.length > 0) {
              value.transitions = Object.fromEntries(
                outgoing.map((doc) => [doc._id, encodeTransition(doc, scope, outputs, results)])
              )
            }
            return [state._id, value]
          })
        )
        return [proc._id, data]
      })
    )
  }
  const known = new Set([...Object.values(SECTIONS), PROCESS, STATE, TRANSITION])
  const remaining = docs.filter((doc) => !known.has(doc._class))
  if (remaining.length > 0) {
    result.documents = {}
    for (const doc of remaining) {
      const group = result.documents as Record<string, Record<string, unknown>>
      group[doc._class] ??= {}
      group[doc._class][doc._id] = encodeDocument(doc)
    }
  }
  return result
}

/** Restores native identities, ownership, operation ids and rank from readable block order. */
export function decodeAuthoringLayout (root: Record<string, unknown>, model?: ModelDb): AuthoringNativeDocument[] {
  object(root, '$', ['version', 'kind', 'catalog', 'processes', 'documents', ...Object.keys(SECTIONS)])
  const docs: AuthoringNativeDocument[] = []
  const ranks = new Map<string, string>()
  const add = (id: string, clazz: string, data: Record<string, unknown>, group: string): AuthoringNativeDocument => {
    for (const key of ['_id', '_class', ...(RANKED.has(clazz) ? ['rank'] : [])]) {
      if (data[key] !== undefined) fail(`${id}.${key}`, 'This property is generated from the block name and order')
    }
    const doc: AuthoringNativeDocument = {
      ...data,
      _id: id,
      _class: clazz,
      space: text(data.space ?? MODEL_SPACE, `${id}.space`)
    }
    if (RANKED.has(clazz)) {
      const key = `${clazz}:${group}`
      doc.rank = makeRank(ranks.get(key), undefined)
      ranks.set(key, doc.rank as string)
    }
    docs.push(doc)
    return doc
  }
  const decodeDocument = (
    value: unknown,
    path: string,
    aliases: Record<string, string> = {},
    clazz: string = ''
  ): Record<string, unknown> => {
    const data = rename(object(value, path), aliases, true)
    documentMetadata(data, true, clazz, path)
    return data
  }
  for (const [section, clazz] of Object.entries(SECTIONS)) {
    for (const [id, value] of Object.entries(object(root[section] ?? {}, section))) {
      add(id, clazz, decodeDocument(value, `${section}.${id}`, {}, clazz), '')
    }
  }
  for (const [id, value] of Object.entries(object(root.processes ?? {}, 'processes'))) {
    const source = object(value, `processes.${id}`)
    const { start, states, ...properties } = source
    const data = decodeDocument(properties, `processes.${id}`, { name: 'label', requiredSlots: 'slots' }, PROCESS)
    if (root.kind === 'card' && data.masterTag === undefined) {
      fail(`processes.${id}.masterTag`, 'An embedded process needs its owning card type reference')
    }
    data.masterTag ??= '__MASTER_TAG__'
    data.context ??= {}
    const contexts = object(data.context, `processes.${id}.context`)
    const slots = object(data.requiredSlots ?? {}, `processes.${id}.slots`)
    const declared = { ...contexts }
    const declarations = [
      ...Object.values(object(start ?? {}, `processes.${id}.start`)),
      ...Object.values(object(states ?? {}, `processes.${id}.states`)).flatMap((value) =>
        Object.values(object(object(value, 'state').transitions ?? {}, 'transitions'))
      )
    ]
    for (const value of declarations) {
      for (const step of Object.values(object(object(value, 'transition').actions ?? {}, 'actions'))) {
        const output = object(step, 'action').as
        if (output !== undefined) {
          declared[text(typeof output === 'string' ? output : object(output, 'as').key, 'as.key')] = undefined
        }
        const results = object(step, 'action').results
        if (results !== undefined && !Array.isArray(results)) {
          for (const key of Object.keys(object(results, 'results'))) declared[key] = undefined
        }
      }
    }
    const environment = { model, catalog: root.catalog as Record<string, unknown> | undefined }
    const scope: AuthoringReferenceScope = { slots, contexts: declared, environment }
    data.requiredSlots =
      data.requiredSlots === undefined
        ? undefined
        : authoringSlotReferences(slots, true, scope, `processes.${id}.slots`)
    if (data.requiredSlots === undefined) delete data.requiredSlots
    data.masterTag = authoringSlotReferences(data.masterTag, true, scope, `processes.${id}.masterTag`)
    add(id, PROCESS, data, '')
    const transition = (key: string, value: unknown, from: string | null, path: string): void => {
      const source = object(value, path)
      const { on, actions, ...properties } = source
      const data = decodeDocument(properties, path)
      for (const key of ['process', 'from', 'trigger', 'triggerParams']) {
        if (data[key] !== undefined) fail(`${path}.${key}`, 'Use the enclosing state and on declaration')
      }
      let trigger: string
      let triggerParams: unknown
      if (typeof on === 'string') {
        trigger = text(on, `${path}.on`)
        triggerParams = {}
      } else {
        const entries = Object.entries(object(on, `${path}.on`))
        if (entries.length !== 1) fail(`${path}.on`, 'Expected exactly one trigger')
        ;[trigger, triggerParams] = entries[0]
      }
      data.trigger = trigger.includes(':') ? trigger : `process:trigger:${trigger}`
      data.triggerParams = authoringReferenceValues(triggerParams, true, scope, `${path}.on`)
      validateAuthoringParameters(
        authoringOperationContract(String(data.trigger), 'triggers', environment),
        data.triggerParams,
        `${path}.on.${trigger}`
      )
      data.process = id
      data.from = from
      data.actions = Object.entries(object(actions ?? {}, `${path}.actions`)).map(([actionId, step]) => {
        const actionPath = `${path}.actions.${actionId}`
        const { as: output, ...properties } = object(step, actionPath)
        const action = rename(properties, { methodId: 'method' }, true)
        if (action._id !== undefined) fail(`${path}.actions.${actionId}._id`, 'Use the action block name')
        const method = text(action.methodId, `${path}.actions.${actionId}.method`)
        action.methodId = method.includes(':') ? method : `process:method:${method}`
        action._id = actionId
        action.params = authoringReferenceValues(action.params ?? {}, true, scope, `${actionPath}.params`)
        validateAuthoringParameters(
          authoringOperationContract(String(action.methodId), 'methods', environment),
          action.params,
          `${actionPath}.params`
        )
        action.context = action.context === undefined ? null : metadata(action.context, true)
        const results = action.results
        if (Array.isArray(results)) action.results = metadata(results, true)
        if (output !== undefined) {
          if (action.context !== null) fail(`${actionPath}.as`, 'Use either as or an explicit action context')
          const declaration = typeof output === 'string' ? output : { ...object(output, `${actionPath}.as`) }
          if (typeof declaration !== 'string' && declaration.class !== undefined) {
            declaration.class = className(
              authoringSlotReferences(declaration.class, true, scope, `${actionPath}.as.class`),
              true
            )
          }
          publishAuthoringOutput(
            declaration,
            action,
            key,
            contexts,
            { model, catalog: root.catalog as Record<string, unknown> | undefined },
            `${actionPath}.as`
          )
        }
        if (results !== undefined && !Array.isArray(results)) {
          publishAuthoringResults(
            authoringSlotReferences(results, true, scope, `${actionPath}.results`),
            action,
            key,
            contexts,
            `${actionPath}.results`,
            (value, at) => authoringReferenceValues(value, true, scope, at)
          )
        }
        return action
      })
      add(key, TRANSITION, data, id)
    }
    for (const [key, value] of Object.entries(object(start ?? {}, `processes.${id}.start`))) {
      transition(key, value, null, `processes.${id}.start.${key}`)
    }
    for (const [key, value] of Object.entries(object(states ?? {}, `processes.${id}.states`))) {
      const source = object(value, `processes.${id}.states.${key}`)
      const { transitions, ...properties } = source
      const state = decodeDocument(properties, `processes.${id}.states.${key}`, { title: 'label' })
      if (state.process !== undefined) {
        fail(`processes.${id}.states.${key}.process`, 'Ownership is determined by the enclosing process')
      }
      state.process = id
      state.title ??= key
      const native = add(key, STATE, state, id)
      for (const [key, value] of Object.entries(object(transitions ?? {}, 'transitions'))) {
        transition(key, value, native._id, `processes.${id}.states.${native._id}.transitions.${key}`)
      }
    }
  }
  for (const [clazz, entries] of Object.entries(object(root.documents ?? {}, 'documents'))) {
    for (const [id, value] of Object.entries(object(entries, `documents.${clazz}`))) {
      add(id, clazz, decodeDocument(value, `documents.${clazz}.${id}`, {}, clazz), '')
    }
  }
  return docs
}
