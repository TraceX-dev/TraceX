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

import { dump } from 'js-yaml'
import { compileProcessYaml } from './authoring'
import { createContext, parseDSLContext } from './dslContext'
import { fail, list, object, ProcessAuthoringError, text } from './authoring-validation'
import { exportAuthoringModel } from './authoring-model'

interface NativeDocument extends Record<string, unknown> {
  _id: string
  _class: string
}

const BASE_KEYS = ['_id', '_class', 'space', 'modifiedBy', 'modifiedOn', 'createdBy', 'createdOn']
const DOCUMENT_KEYS: Record<string, string[]> = {
  'card:class:MasterTag': ['extends', 'kind', 'label', 'description', 'icon', 'color', 'background'],
  'core:class:Attribute': [
    'attributeOf',
    'name',
    'label',
    'type',
    'isCustom',
    'required',
    'readonly',
    'automationOnly',
    'rank',
    'defaultValue'
  ],
  'core:class:Enum': ['name', 'enumValues'],
  'process:class:Process': [
    'masterTag',
    'name',
    'description',
    'rank',
    'context',
    'autoStart',
    'showInHeader',
    'parallelExecutionForbidden',
    'automationOnly',
    'requiredSlots',
    'bindings'
  ],
  'process:class:State': ['process', 'title', 'rank'],
  'process:class:Transition': ['process', 'from', 'to', 'rank', 'trigger', 'triggerParams', 'actions']
}

function clean (value: unknown, path: string, keys?: string[]): Record<string, unknown> {
  const data = object(value, path)
  return object(Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)), path, keys)
}

function label (value: unknown, fallback: string, path: string): string {
  if (value === undefined) return fallback
  const supplied = text(value, path)
  const prefix = 'embedded:embedded:'
  if (!supplied.startsWith(prefix)) {
    fail(
      path,
      'YAML export requires an embedded label; localized resource labels cannot be converted without losing their identity'
    )
  }
  return supplied.slice(prefix.length)
}

function symbol (value: string, fallback: string, used: Set<string>): string {
  let key = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+$/, '')
  if (!/^[a-z]/.test(key) || ['constructor', 'prototype'].includes(key)) key = fallback
  const base = key
  let index = 2
  while (used.has(key)) key = `${base}_${index++}`
  used.add(key)
  return key
}

function sorted (docs: NativeDocument[]): NativeDocument[] {
  return [...docs].sort((a, b) =>
    String(a.rank ?? '') < String(b.rank ?? '') ? -1 : String(a.rank ?? '') > String(b.rank ?? '') ? 1 : 0
  )
}

class Exporter {
  readonly docs: NativeDocument[]
  readonly fields = new Map<string, string>()
  private readonly choiceFields = new Set<string>()
  private readonly usedEnums = new Set<string>()
  private readonly enumKeys = new Map<string, string>()

  constructor (documents: readonly unknown[]) {
    const ids = new Set<string>()
    this.docs = documents.map((value, index) => {
      const path = `documents[${index}]`
      const data = clean(value, path)
      const clazz = text(data._class, `${path}._class`)
      if (!Object.prototype.hasOwnProperty.call(DOCUMENT_KEYS, clazz)) {
        fail(path, `YAML does not support ${clazz}; use JSON export`)
      }
      clean(data, path, [...BASE_KEYS, ...DOCUMENT_KEYS[clazz]])
      const id = text(data._id, `${path}._id`)
      if (ids.has(id)) fail(path, 'Duplicate document identifier')
      ids.add(id)
      if (data.space !== 'core:space:Model') fail(`${path}.space`, 'Expected model documents')
      return { ...data, _id: id, _class: clazz }
    })
  }

  field (name: string, path: string): string {
    const key = this.fields.get(name)
    if (key === undefined) fail(path, `Undeclared field ${name}; export a template with attribute slots`)
    return key
  }

  fieldType (value: unknown, path: string, choices?: unknown): Record<string, unknown> {
    const type = clean(value, path, ['_class', 'label', 'of', 'to'])
    const typeLabels: Record<string, string> = {
      'core:class:ArrOf': 'core:string:Array',
      'core:class:RefTo': 'core:string:Ref',
      'core:class:EnumOf': 'core:string:Enum',
      'core:class:TypeNumber': 'core:string:Number',
      'core:class:TypeString': 'core:string:String'
    }
    if (type.label !== undefined && type.label !== typeLabels[String(type._class)]) {
      fail(`${path}.label`, 'Custom type labels require JSON export')
    }
    clean(type, path, [
      '_class',
      'label',
      ...(type._class === 'core:class:RefTo'
        ? ['to']
        : type._class === 'core:class:ArrOf' || type._class === 'core:class:EnumOf'
          ? ['of']
          : [])
    ])
    if (type._class === 'core:class:ArrOf') {
      const nested = this.fieldType(type.of, `${path}.of`, choices)
      if (nested.type !== 'employee') fail(path, 'Only employee arrays are supported by YAML')
      return { ...nested, multiple: true }
    }
    if (type._class === 'core:class:RefTo' && type.to === 'contact:mixin:Employee') return { type: 'employee' }
    if (type._class === 'core:class:TypeNumber') return { type: 'number' }
    if (type._class === 'core:class:TypeString') return { type: 'string' }
    if (type._class === 'core:class:EnumOf') {
      const id = text(type.of, `${path}.of`)
      const enumeration = this.docs.find((doc) => doc._id === id && doc._class === 'core:class:Enum')
      if (enumeration !== undefined) this.usedEnums.add(id)
      return { choice: list(enumeration?.enumValues ?? choices, `${path}.choices`) }
    }
    return fail(path, 'This field type is not supported by YAML; use JSON export')
  }

  expression (value: unknown, path: string): string {
    if (typeof value === 'number' && Number.isFinite(value) && /^-?\d+(\.\d+)?$/.test(String(value))) {
      return String(value)
    }
    if (typeof value !== 'string' || !value.startsWith('${')) fail(path, 'Unsupported calculation value')
    const context = parseDSLContext(value)
    if (
      context === undefined ||
      createContext(context) !== value ||
      context.sourceFunction !== undefined ||
      context.fallbackValue !== undefined
    ) {
      fail(path, 'Unsupported native expression or modifier; use JSON export')
    }
    let expression: string
    if (context.type === 'attribute') expression = this.field(context.key, path)
    else if (context.type === 'const' && context.key === '') expression = this.expression(context.value, path)
    else return fail(path, 'Only scalar attribute and numeric constant expressions can be exported')
    const functions = [...(context.functions ?? [])]
    if (
      functions[0]?.func === 'process:function:StringFromEnum' &&
      functions[1]?.func === 'process:function:NumberFromString'
    ) {
      if (
        context.type !== 'attribute' ||
        Object.keys(functions[0].props).length > 0 ||
        Object.keys(functions[1].props).length > 0
      ) {
        fail(path, 'Unsupported numeric conversion')
      }
      if (!this.choiceFields.has(expression)) fail(path, 'Enum conversion requires a choice field; use JSON export')
      expression = `number(${expression})`
      functions.splice(0, 2)
    }
    for (const func of functions) {
      if (
        func.func !== 'process:function:Multiply' ||
        Object.keys(func.props).length !== 1 ||
        !Object.prototype.hasOwnProperty.call(func.props, 'value')
      ) {
        fail(path, `Unsupported transform ${func.func}; use JSON export`)
      }
      const operand = this.expression(func.props.value, path)
      if (operand.includes('*')) {
        fail(
          path,
          'A grouped multiplication operand cannot be flattened without changing numeric evaluation order; use JSON export'
        )
      }
      expression += ` * ${operand}`
    }
    return expression
  }

  match (value: unknown, path: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [name, query] of Object.entries(clean(value, path))) {
      const key = this.field(name, `${path}.${name}`)
      if (query === null || typeof query !== 'object') result[key] = query
      else {
        const operators = clean(query, `${path}.${name}`, ['$exists', '$ne', '$in', '$gt', '$gte', '$lt', '$lte'])
        result[key] = Object.fromEntries(
          Object.entries(operators).map(([operator, operand]) => [operator.slice(1), operand])
        )
      }
    }
    return result
  }

  process (proc: NativeDocument, standalone: boolean): Record<string, unknown> {
    const path = `process.${proc._id}`
    const result: Record<string, unknown> = {
      label: text(proc.name, `${path}.name`),
      description: proc.description ?? '',
      autoStart: proc.autoStart ?? false,
      showInHeader: proc.showInHeader ?? true,
      parallelExecutionForbidden: proc.parallelExecutionForbidden ?? false,
      ...(proc.automationOnly !== undefined ? { automationOnly: proc.automationOnly } : {})
    }
    if (result.description === '') delete result.description
    if (standalone) {
      const slots: Record<string, unknown> = {}
      const used = new Set<string>()
      const bindings = clean(proc.bindings ?? {}, `${path}.bindings`)
      for (const [key, value] of Object.entries(clean(proc.requiredSlots ?? {}, `${path}.slots`))) {
        const slot = clean(value, `${path}.slots.${key}`, [
          'slotKind',
          '_class',
          'name',
          'label',
          'type',
          'enumValues',
          'memberOf'
        ])
        if (slot.slotKind !== 'attribute' || slot.memberOf !== undefined) {
          fail(`${path}.slots.${key}`, 'Only attribute slots on the destination card are supported by YAML')
        }
        if (
          slot._class !== 'core:class:Attribute' &&
          slot._class !== clean(slot.type, `${path}.slots.${key}.type`)._class
        ) {
          fail(`${path}.slots.${key}._class`, 'Slot class does not match its field type')
        }
        const title = label(slot.label, String(slot.name ?? key), `${path}.slots.${key}.label`)
        const alias = symbol(title, `field${used.size + 1}`, used)
        this.fields.set(`__SLOT_${key}__`, alias)
        if (bindings[key] !== undefined) this.fields.set(text(bindings[key], `${path}.bindings.${key}`), alias)
        const type = this.fieldType(slot.type, `${path}.slots.${key}.type`, slot.enumValues)
        if (type.choice !== undefined) this.choiceFields.add(alias)
        slots[alias] = { kind: 'attribute', label: title, ...type }
      }
      result.slots = slots
    } else if (Object.keys(clean(proc.requiredSlots ?? {}, `${path}.slots`)).length > 0) {
      fail(path, 'Embedded process slots must be bound before YAML export')
    }
    const nativeStates = sorted(
      this.docs.filter((doc) => doc._class === 'process:class:State' && doc.process === proc._id)
    )
    const nativeTransitions = sorted(
      this.docs.filter((doc) => doc._class === 'process:class:Transition' && doc.process === proc._id)
    )
    const states = new Map<string, string>()
    const usedStates = new Set<string>()
    for (const state of nativeStates) {
      states.set(state._id, symbol(text(state.title, `${path}.states.title`), `state${states.size + 1}`, usedStates))
    }
    const destination = (id: unknown): string => {
      const key = states.get(String(id))
      if (key === undefined) fail(path, 'Transition references a missing state')
      return key
    }
    const contexts = clean(proc.context ?? {}, `${path}.context`)
    const taskKeys = new Map<string, string>()
    const order = [
      ...nativeTransitions.filter((transition) => transition.from === null),
      ...nativeStates.flatMap((state) => nativeTransitions.filter((transition) => transition.from === state._id))
    ]
    if (order.length !== nativeTransitions.length) fail(path, 'Transition has an unknown source state')
    const actions = (transition: NativeDocument): unknown[] =>
      list(transition.actions, `${path}.actions`).map((value, index) => {
        const at = `${path}.transitions.${transition._id}.actions[${index}]`
        const action = clean(value, at, ['_id', 'methodId', 'context', 'params', 'results'])
        if (action.results !== undefined && list(action.results, `${at}.results`).length > 0) {
          fail(at, 'Action results are not supported by YAML')
        }
        if (action.methodId === 'process:method:UpdateCard') {
          if (action.context != null) fail(at, 'UpdateCard must not publish a context')
          return {
            update: Object.fromEntries(
              Object.entries(clean(action.params, `${at}.params`)).map(([key, value]) => [
                this.field(key, at),
                typeof value === 'string' && value.startsWith('${') ? { calculate: this.expression(value, at) } : value
              ])
            )
          }
        }
        if (action.methodId !== 'process:method:CreateToDo') {
          fail(at, `Unsupported action ${String(action.methodId)}; use JSON export`)
        }
        const params = clean(action.params, `${at}.params`, ['title', 'user', 'completionMode', 'withRollback'])
        const id = text(clean(action.context, `${at}.context`, ['_id'])._id, `${at}.context._id`)
        const definition = clean(contexts[id], `${path}.context.${id}`, [
          'name',
          '_class',
          'action',
          'index',
          'producer',
          'value'
        ])
        const published = clean(definition.value, `${at}.value`, ['type', 'id', 'key'])
        if (
          definition._class !== 'process:class:ProcessToDo' ||
          definition.action !== action._id ||
          definition.producer !== transition._id ||
          definition.index !== taskKeys.size + 1 ||
          published.type !== 'context' ||
          published.id !== id ||
          published.key !== '' ||
          taskKeys.has(id)
        ) {
          fail(at, 'Task context metadata cannot be represented by YAML')
        }
        const userSource = text(params.user, `${at}.user`)
        const user = parseDSLContext(userSource)
        if (
          user?.type !== 'attribute' ||
          createContext(user) !== userSource ||
          (user.functions?.length ?? 0) > 0 ||
          user.sourceFunction !== undefined ||
          user.fallbackValue !== undefined
        ) {
          fail(at, 'Task users must reference an employee attribute')
        }
        const key = `task${taskKeys.size + 1}`
        taskKeys.set(id, key)
        return {
          task: {
            key,
            title: params.title,
            users: this.field(user.key, `${at}.user`),
            completion: params.completionMode,
            rollback: params.withRollback,
            contextLabel: definition.name
          }
        }
      })
    const compiledActions = new Map(order.map((transition) => [transition._id, actions(transition)]))
    if (taskKeys.size !== Object.keys(contexts).length) {
      fail(`${path}.context`, 'Unreferenced or unsupported execution contexts cannot be omitted from YAML')
    }
    const starts = order.filter((transition) => transition.from === null)
    if (
      starts.length !== 1 ||
      starts[0].trigger !== 'process:trigger:OnExecutionStart' ||
      Object.keys(clean(starts[0].triggerParams, `${path}.start`)).length > 0
    ) {
      fail(`${path}.start`, 'YAML requires one unconditional execution-start transition')
    }
    const graphTransition = (transition: NativeDocument): Record<string, unknown> => {
      const params = clean(transition.triggerParams, `${path}.triggerParams`)
      let on: Record<string, unknown>
      if (transition.trigger === 'process:trigger:OnCardUpdate') on = { matches: this.match(params, `${path}.matches`) }
      else if (transition.trigger === 'process:trigger:WhenFieldChanges') {
        const entries = Object.entries(params)
        if (entries.length !== 1 || JSON.stringify(entries[0][1]) !== '{"$exists":true}') {
          fail(path, 'YAML changed triggers require one field with an exists guard')
        }
        on = { changed: this.field(entries[0][0], path) }
      } else if (transition.trigger === 'process:trigger:OnToDoClose') {
        clean(params, `${path}.triggerParams`, ['_id'])
        const source = text(params._id, `${path}.triggerParams._id`)
        const context = parseDSLContext(source)
        if (
          context?.type !== 'context' ||
          context.key !== '' ||
          createContext(context) !== source ||
          (context.functions?.length ?? 0) > 0 ||
          context.sourceFunction !== undefined ||
          context.fallbackValue !== undefined ||
          !taskKeys.has(context.id)
        ) {
          fail(path, 'Unsupported task completion context')
        }
        on = { tasksCompleted: taskKeys.get(context.id) }
      } else return fail(path, `Unsupported trigger ${String(transition.trigger)}; use JSON export`)
      return { on, to: destination(transition.to), actions: compiledActions.get(transition._id) }
    }
    result.start = { to: destination(starts[0].to), actions: compiledActions.get(starts[0]._id) }
    result.states = Object.fromEntries(
      nativeStates.map((state) => [
        states.get(state._id),
        {
          label: state.title,
          transitions: nativeTransitions.filter((transition) => transition.from === state._id).map(graphTransition)
        }
      ])
    )
    return result
  }

  card (): Record<string, unknown> {
    const masters = this.docs.filter((doc) => doc._class === 'card:class:MasterTag')
    if (masters.length !== 1) {
      fail('card', 'YAML supports one card type per module; inheritance and dependent types require JSON')
    }
    const master = masters[0]
    if (master.extends !== 'card:class:Card' || master.kind !== 0) {
      fail('card.extends', 'Custom inheritance requires JSON export')
    }
    const title = label(master.label, 'Card', 'card.label')
    const fields: Record<string, unknown> = {}
    const used = new Set<string>()
    for (const attr of sorted(this.docs.filter((doc) => doc._class === 'core:class:Attribute'))) {
      if (attr.attributeOf !== master._id || attr.isCustom !== true) {
        fail(`fields.${attr._id}`, 'Only custom fields belonging to this card type can be exported')
      }
      if ((attr.readonly ?? false) !== (attr.automationOnly ?? false)) {
        fail(`fields.${attr._id}`, 'Separate readonly and automationOnly settings require JSON export')
      }
      const name = text(attr.name, `fields.${attr._id}.name`)
      if (this.fields.has(name)) fail('card.fields', 'Duplicate stored field key')
      const title = label(attr.label, name, `fields.${name}.label`)
      const key = symbol(title, `field${used.size + 1}`, used)
      this.fields.set(name, key)
      const type = this.fieldType(attr.type, `fields.${name}.type`)
      if (type.choice !== undefined) this.choiceFields.add(key)
      const enumId = clean(attr.type, `fields.${name}.type`).of
      if (type.choice !== undefined && typeof enumId === 'string') {
        if (!this.enumKeys.has(enumId)) this.enumKeys.set(enumId, `enum${this.enumKeys.size + 1}`)
        type.enumKey = this.enumKeys.get(enumId)
        type.enumName = this.docs.find((doc) => doc._id === enumId)?.name
      }
      fields[key] = {
        label: title,
        ...type,
        required: attr.required ?? false,
        readonly: attr.readonly ?? false,
        ...(attr.defaultValue !== undefined ? { default: attr.defaultValue } : {})
      }
    }
    const processes = sorted(this.docs.filter((doc) => doc._class === 'process:class:Process'))
    if (processes.some((proc) => proc.masterTag !== master._id)) {
      fail('card.processes', 'A process belongs to another card type')
    }
    const result: Record<string, unknown> = {
      key: symbol(title, 'card', new Set()),
      label: title,
      fields,
      processes: Object.fromEntries(processes.map((proc, index) => [`process${index + 1}`, this.process(proc, false)]))
    }
    for (const key of ['description', 'icon', 'color', 'background']) {
      if (master[key] !== undefined && master[key] !== '') result[key] = master[key]
    }
    return result
  }

  finish (kind: 'card' | 'process'): string {
    let definition: Record<string, unknown>
    const processes = this.docs.filter((doc) => doc._class === 'process:class:Process')
    if (kind === 'card') definition = this.card()
    else {
      if (
        processes.length !== 1 ||
        this.docs.some((doc) => doc._class === 'card:class:MasterTag' || doc._class === 'core:class:Attribute')
      ) {
        fail('process', 'Expected one portable process template')
      }
      definition = this.process(processes[0], true)
    }
    for (const doc of this.docs) {
      if (doc._class === 'core:class:Enum' && !this.usedEnums.has(doc._id)) {
        fail(`documents.${doc._id}`, 'Unused enum cannot be omitted from YAML')
      }
      if (
        (doc._class === 'process:class:State' || doc._class === 'process:class:Transition') &&
        !processes.some((proc) => proc._id === doc.process)
      ) {
        fail(`documents.${doc._id}`, 'Document belongs to an unknown process')
      }
    }
    const source = dump({ version: 1, kind, [kind]: definition }, { noRefs: true, lineWidth: 120, sortKeys: false })
    compileProcessYaml(source)
    return source
  }
}

/** Uses concise YAML when lossless; otherwise preserves the complete native model in version 2. */
export function exportProcessYaml (documents: readonly unknown[], kind: 'card' | 'process'): string {
  try {
    return new Exporter(documents).finish(kind)
  } catch (error) {
    if (!(error instanceof ProcessAuthoringError)) throw error
    return exportAuthoringModel(documents, kind)
  }
}

/** Exports a process draft and its existing field bindings for the UI editor. */
export function exportProcessYamlDraft (documents: readonly unknown[]): {
  source: string
  bindings: Record<string, string>
} {
  let exporter: Exporter
  let source: string
  try {
    exporter = new Exporter(documents)
    source = exporter.finish('process')
  } catch (error) {
    if (!(error instanceof ProcessAuthoringError)) throw error
    const source = exportAuthoringModel(documents, 'process')
    const proc = compileProcessYaml(source).docs.find((doc) => doc._class === 'process:class:Process')
    return {
      source,
      bindings: Object.fromEntries(
        Object.entries(clean(proc?.bindings ?? {}, 'process.bindings')).map(([key, value]) => [
          key,
          text(value, `process.bindings.${key}`)
        ])
      )
    }
  }
  const proc = exporter.docs.find((doc) => doc._class === 'process:class:Process')
  const bindings: Record<string, string> = {}
  for (const field of Object.values(clean(proc?.bindings ?? {}, 'process.bindings'))) {
    const name = text(field, 'process.bindings')
    const alias = exporter.fields.get(name)
    if (alias !== undefined) bindings[alias] = name
  }
  return { source, bindings }
}
