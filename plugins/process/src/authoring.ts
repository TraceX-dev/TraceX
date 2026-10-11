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

import card from '@hcengineering/card'
import core, { ClassifierKind, generateId } from '@hcengineering/core'
import type { Doc, ModelDb } from '@hcengineering/core'
import { getEmbeddedLabel } from '@hcengineering/platform'
import { makeRank } from '@hcengineering/rank'
import { JSON_SCHEMA, load, YAMLException } from 'js-yaml'
import { compileCondition, compileExpression, compileMatch } from './authoring-expressions'
import type { AuthoringField } from './authoring-expressions'
import { assertTree, fail, flag, identifier, list, object, ProcessAuthoringError, text } from './authoring-validation'
import type { AuthoringValidation } from './authoring-validation'
import { createContext } from './dslContext'
import { compileAuthoringModel } from './authoring-model'
import type { ContextId } from './index'
import { AuthoringSource } from './authoring-source'

export { ProcessAuthoringError } from './authoring-validation'

/** Native import documents omit runtime transaction metadata. */
export interface AuthoringNativeDocument {
  _id: string
  _class: string
  space: string
  [key: string]: unknown
}

export interface ProcessAuthoringResult {
  kind: 'card' | 'process'
  version?: 1 | 2
  docs: AuthoringNativeDocument[]
  fields: Record<string, string>
}

interface NativeType {
  _class: string
  label: string
  of?: string | NativeType
  to?: string
}

interface Field extends AuthoringField {
  label: string
  required: boolean
  defaultValue?: string | number
  calculation?: unknown
  path: string
  nativeType: NativeType
}

interface Action {
  _id: string
  methodId: string
  context: { _id: string } | null
  params: Record<string, unknown>
}

interface Calculation {
  field: string
  path: string
  dependencies: string[]
  value?: string | number
  cases?: Array<{ field: string, query: Record<string, number> | number, value: string | number }>
  otherwise?: string | number
}

class Compiler {
  readonly docs: AuthoringNativeDocument[] = []
  readonly fields = Object.create(null) as Record<string, Field>
  private counters = Object.create(null) as Record<string, number>
  private readonly enums = new Map<string, { id: string, name: string, values: string[] }>()
  private rank: string | undefined

  constructor (readonly portable: boolean) {}

  id (kind: string): string {
    if (!this.portable) return generateId()
    const index = this.counters[kind] ?? 0
    this.counters[kind] = index + 1
    return kind === 'PROCESS' ? '__PROCESS__' : `__${kind}_${index}__`
  }

  add (clazz: string, values: Record<string, unknown>, id = this.id('DOC')): AuthoringNativeDocument {
    const doc = { _id: id, _class: clazz, space: core.space.Model, ...values }
    this.docs.push(doc)
    return doc
  }

  nextRank (): string {
    this.rank = makeRank(this.rank, undefined)
    return this.rank
  }

  readFields (raw: unknown, path: string, owner: string): void {
    const entries = object(raw, path)
    for (const [key, value] of Object.entries(entries)) {
      const at = `${path}.${key}`
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) fail(at, 'Field keys must be expression identifiers')
      const data = object(value, at, [
        'label',
        'type',
        'choice',
        'multiple',
        'default',
        'required',
        'readonly',
        'calculate',
        ...(this.portable ? ['kind'] : ['enumKey', 'enumName'])
      ])
      if (this.portable && data.kind !== 'attribute') fail(`${at}.kind`, 'Only attribute slots are supported in v1')
      if (
        this.portable &&
        ['default', 'calculate', 'required', 'readonly'].some((property) => data[property] !== undefined)
      ) {
        fail(at, 'Slots describe existing field types, not field configuration; declare calculations on the process')
      }
      let choices: string[] | undefined
      let type: Field['type']
      let nativeType: NativeType
      if (data.choice !== undefined) {
        if (data.type !== undefined) fail(at, 'Use either choice or type')
        choices = list(data.choice, `${at}.choice`).map((item, index) => {
          if (
            (typeof item !== 'string' || item.trim() === '') &&
            (typeof item !== 'number' || !Number.isFinite(item))
          ) {
            fail(`${at}.choice[${index}]`, 'Expected a nonempty string or finite number')
          }
          if (typeof item === 'string' && item.includes('${')) {
            fail(`${at}.choice[${index}]`, 'Raw native context expressions are not supported in choice values')
          }
          return String(item)
        })
        if (choices.length === 0 || new Set(choices).size !== choices.length) {
          fail(`${at}.choice`, 'Choices must be nonempty and unique')
        }
        type = 'choice'
        const enumKey = data.enumKey === undefined ? undefined : identifier(data.enumKey, `${at}.enumKey`)
        const enumName = text(data.enumName ?? data.label ?? key, `${at}.enumName`)
        const existing = enumKey === undefined ? undefined : this.enums.get(enumKey)
        if (
          existing !== undefined &&
          (existing.name !== enumName || JSON.stringify(existing.values) !== JSON.stringify(choices))
        ) {
          fail(at, 'Fields sharing enumKey must use identical enumName and choices')
        }
        const enumId = existing?.id ?? this.id('ENUM')
        nativeType = { _class: core.class.EnumOf, label: core.string.Enum, of: enumId }
        if (!this.portable && existing === undefined) {
          this.add(core.class.Enum, { name: enumName, enumValues: choices }, enumId)
        }
        if (enumKey !== undefined) this.enums.set(enumKey, { id: enumId, name: enumName, values: choices })
      } else {
        if (data.enumKey !== undefined || data.enumName !== undefined) fail(at, 'Enum settings require choice values')
        const supplied = text(data.type, `${at}.type`)
        if (supplied !== 'string' && supplied !== 'number' && supplied !== 'employee') {
          fail(`${at}.type`, 'Supported types: string, number, employee, or choice')
        }
        type = supplied
        nativeType =
          type === 'employee'
            ? { _class: core.class.RefTo, label: core.string.Ref, to: 'contact:mixin:Employee' }
            : {
                _class: type === 'number' ? core.class.TypeNumber : core.class.TypeString,
                label: type === 'number' ? core.string.Number : core.string.String
              }
      }
      const multiple = flag(data.multiple, `${at}.multiple`, false)
      if (multiple && type !== 'employee') fail(`${at}.multiple`, 'Only employee arrays are supported in v1')
      if (multiple) nativeType = { _class: core.class.ArrOf, label: core.string.Array, of: nativeType }
      const label = data.label === undefined ? key : text(data.label, `${at}.label`)
      const field: Field = {
        name: this.portable ? `__SLOT_${key}__` : `custom${generateId()}`,
        label,
        type,
        choices,
        multiple,
        nativeType,
        path: at,
        readonly: flag(data.readonly, `${at}.readonly`, data.calculate !== undefined),
        required: flag(data.required, `${at}.required`, false),
        calculation: data.calculate
      }
      if (data.calculate !== undefined && type !== 'number' && type !== 'choice' && type !== 'string') {
        fail(`${at}.calculate`, 'Calculation requires a scalar field')
      }
      if (data.calculate !== undefined && data.readonly === false) {
        fail(`${at}.readonly`, 'Calculated fields must be readonly')
      }
      if (data.default !== undefined) field.defaultValue = this.literal(field, data.default, `${at}.default`)
      if (field.calculation !== undefined && field.defaultValue !== undefined) {
        fail(at, 'Calculated fields cannot have defaults')
      }
      this.fields[key] = field
      if (!this.portable) {
        this.add(core.class.Attribute, {
          attributeOf: owner,
          name: field.name,
          label: getEmbeddedLabel(label),
          type: nativeType,
          isCustom: true,
          required: field.required,
          readonly: field.readonly,
          automationOnly: field.readonly,
          rank: this.nextRank(),
          ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {})
        })
      }
    }
  }

  literal (field: Field, value: unknown, path: string): string | number {
    if (typeof value === 'string' && value.includes('${')) {
      fail(path, 'Raw native context expressions are not supported in literals; use calculate')
    }
    if (field.type === 'choice') {
      if ((typeof value !== 'string' && typeof value !== 'number') || !field.choices?.includes(String(value))) {
        fail(path, 'Value must belong to the declared choices')
      }
      return String(value)
    }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'Expected a finite number')
      return value
    }
    if (field.type === 'string' && typeof value === 'string') return value
    return fail(path, 'This field requires a scalar string/number value; employee literals are not supported')
  }

  getField (key: string, path: string): Field {
    const field = this.fields[key]
    if (!Object.prototype.hasOwnProperty.call(this.fields, key)) fail(path, `Unknown field or slot "${key}"`)
    return field
  }

  calculations (raw: Record<string, unknown>, location?: string): Calculation[] {
    const parsed = Object.create(null) as Record<string, Calculation>
    for (const [key, value] of Object.entries(raw)) {
      const field = this.getField(key, `${location ?? 'calculations'}.${key}`)
      const path = location === undefined ? `${field.path}.calculate` : `${location}.${key}`
      if (field.multiple || field.type === 'employee') fail(path, 'Calculated output must be a scalar')
      if (typeof value === 'string') {
        const expression = compileExpression(value, this.fields, path)
        if (expression.type !== field.type) fail(path, 'Expression type does not match the output field')
        if (
          field.type === 'choice' &&
          this.fields[expression.dependencies[0]].choices?.some((choice) => !field.choices?.includes(choice)) === true
        ) {
          fail(path, 'The output choices must include every possible input choice')
        }
        parsed[key] = { field: key, path, dependencies: expression.dependencies, value: expression.value }
      } else {
        const data = object(value, path, ['cases', 'otherwise'])
        const cases = list(data.cases, `${path}.cases`).map((item, index) => {
          const at = `${path}.cases[${index}]`
          const branch = object(item, at, ['when', 'value'])
          const condition = compileCondition(text(branch.when, `${at}.when`), this.fields, `${at}.when`)
          return { ...condition, value: this.literal(field, branch.value, `${at}.value`) }
        })
        if (cases.length === 0) fail(`${path}.cases`, 'At least one case is required')
        parsed[key] = {
          field: key,
          path,
          cases,
          dependencies: [...new Set(cases.map((branch) => branch.field))],
          otherwise: this.literal(field, data.otherwise, `${path}.otherwise`)
        }
      }
    }
    const sorted: Calculation[] = []
    const active = new Set<string>()
    const done = new Set<string>()
    const visit = (key: string): void => {
      if (done.has(key)) return
      if (active.has(key)) fail(parsed[key].path, `Cyclic calculation dependency at "${key}"`)
      active.add(key)
      for (const dep of parsed[key].dependencies) if (parsed[dep] !== undefined) visit(dep)
      active.delete(key)
      done.add(key)
      sorted.push(parsed[key])
    }
    for (const key of Object.keys(parsed)) visit(key)
    return sorted
  }

  definition (data: Record<string, unknown>, owner: string, path = 'process'): AuthoringNativeDocument {
    const label = text(data.label, `${path}.label`)
    return this.add(
      'process:class:Process',
      {
        masterTag: owner,
        rank: this.nextRank(),
        name: label,
        description: data.description === undefined ? '' : text(data.description, `${path}.description`),
        autoStart: flag(data.autoStart, `${path}.autoStart`, false),
        showInHeader: flag(data.showInHeader, `${path}.showInHeader`, true),
        parallelExecutionForbidden: flag(data.parallelExecutionForbidden, `${path}.parallelExecutionForbidden`, true),
        ...(data.automationOnly !== undefined
          ? { automationOnly: flag(data.automationOnly, `${path}.automationOnly`, false) }
          : {}),
        context: {}
      },
      this.id('PROCESS')
    )
  }

  state (process: string, title: string): AuthoringNativeDocument {
    return this.add('process:class:State', { process, title, rank: this.nextRank() }, this.id('STATE'))
  }

  update (values: Record<string, unknown>): Action {
    return { _id: this.id('ACTION'), methodId: 'process:method:UpdateCard', context: null, params: values }
  }

  transition (
    process: string,
    from: string | null,
    to: string,
    trigger: string,
    params: Record<string, unknown>,
    actions: Action[]
  ): AuthoringNativeDocument {
    return this.add(
      'process:class:Transition',
      {
        process,
        from,
        to,
        trigger: `process:trigger:${trigger}`,
        triggerParams: params,
        actions,
        rank: this.nextRank()
      },
      this.id('TRANSITION')
    )
  }

  compileCalculations (definition: AuthoringNativeDocument, calculations: Calculation[]): void {
    if (calculations.length === 0) fail('process.calculations', 'At least one calculation is required')
    const wait = this.state(definition._id, 'Wait for input changes')
    const states = calculations.map((calculation) =>
      this.state(definition._id, `Calculate ${this.fields[calculation.field].label}`)
    )
    const outputs = new Set(calculations.map((calculation) => calculation.field))
    const inputs = [
      ...new Set(calculations.flatMap((calculation) => calculation.dependencies).filter((key) => !outputs.has(key)))
    ]
    const guard: Record<string, unknown> = {}
    for (const key of inputs) {
      const field = this.fields[key]
      guard[field.name] = field.type === 'choice' ? { $in: field.choices } : { $exists: true, $ne: null }
    }
    const ready = this.state(definition._id, 'Validate inputs')
    this.transition(definition._id, null, ready._id, 'OnExecutionStart', {}, [])
    for (const key of inputs) {
      this.transition(
        definition._id,
        wait._id,
        ready._id,
        'WhenFieldChanges',
        { [this.fields[key].name]: { $exists: true } },
        []
      )
    }
    if (inputs.length === 0) {
      fail('process.calculations', 'A recalculation process requires at least one external input field')
    }
    this.transition(definition._id, ready._id, states[0]._id, 'OnCardUpdate', guard, [])
    for (const [index, calculation] of calculations.entries()) {
      const to = states[index + 1]?._id ?? wait._id
      const output = this.fields[calculation.field].name
      if (calculation.cases !== undefined) {
        for (const branch of calculation.cases) {
          this.transition(
            definition._id,
            states[index]._id,
            to,
            'OnCardUpdate',
            { [this.fields[branch.field].name]: branch.query },
            [this.update({ [output]: branch.value })]
          )
        }
        this.transition(definition._id, states[index]._id, to, 'OnCardUpdate', {}, [
          this.update({ [output]: calculation.otherwise })
        ])
      } else {
        this.transition(definition._id, states[index]._id, to, 'OnCardUpdate', {}, [
          this.update({ [output]: calculation.value })
        ])
      }
    }
  }

  compileGraph (definition: AuthoringNativeDocument, raw: Record<string, unknown>, path = 'process'): void {
    const stateData = object(raw.states, `${path}.states`)
    if (Object.keys(stateData).length === 0) fail(`${path}.states`, 'At least one state is required')
    const states = Object.create(null) as Record<string, AuthoringNativeDocument>
    const contexts = Object.create(null) as Record<string, string>
    const contextDefinitions: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(stateData)) {
      identifier(key, `${path}.states.${key}`)
      const state = object(value, `${path}.states.${key}`, ['label', 'transitions'])
      states[key] = this.state(
        definition._id,
        state.label === undefined ? key : text(state.label, `${path}.states.${key}.label`)
      )
    }
    const resolveState = (value: unknown, path: string): string => {
      const key = text(value, path)
      if (states[key] === undefined) fail(path, `Unknown state "${key}"`)
      return states[key]._id
    }
    const actions = (value: unknown, path: string, transitionId: string): Action[] => {
      if (value === undefined) return []
      return list(value, path).map((item, index) => {
        const at = `${path}[${index}]`
        const data = object(item, at, ['update', 'task'])
        if (Object.keys(data).length !== 1) fail(at, 'An action must contain exactly one of update or task')
        if (data.update !== undefined) {
          const values = object(data.update, `${at}.update`)
          if (Object.keys(values).length === 0) fail(`${at}.update`, 'At least one field update is required')
          const updates: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(values)) {
            const path = `${at}.update.${key}`
            const field = this.getField(key, path)
            if (value !== null && typeof value === 'object') {
              const expression = object(value, path, ['calculate'])
              const compiled = compileExpression(
                text(expression.calculate, `${path}.calculate`),
                this.fields,
                `${path}.calculate`
              )
              if (compiled.type !== field.type) fail(path, 'Expression type does not match the output field')
              if (
                field.type === 'choice' &&
                this.fields[compiled.dependencies[0]].choices?.some((choice) => !field.choices?.includes(choice)) ===
                  true
              ) {
                fail(path, 'The output choices must include every possible input choice')
              }
              updates[field.name] = compiled.value
            } else {
              updates[field.name] = this.literal(field, value, path)
            }
          }
          return this.update(updates)
        }
        const task = object(data.task, `${at}.task`, [
          'key',
          'title',
          'users',
          'completion',
          'rollback',
          'contextLabel'
        ])
        const key = identifier(task.key, `${at}.task.key`)
        if (contexts[key] !== undefined) fail(`${at}.task.key`, 'Task context keys must be unique')
        const users = this.getField(text(task.users, `${at}.task.users`), `${at}.task.users`)
        if (users.type !== 'employee') fail(`${at}.task.users`, 'Task recipients must be an employee field or slot')
        if (task.completion !== 'all' && task.completion !== 'any') fail(`${at}.task.completion`, 'Expected all or any')
        if (typeof task.rollback !== 'boolean') fail(`${at}.task.rollback`, 'An explicit rollback boolean is required')
        const title = text(task.title, `${at}.task.title`)
        if (title.includes('${')) fail(`${at}.task.title`, 'Task titles must be literal text in v1')
        const contextId = this.id('CONTEXT')
        contexts[key] = contextId
        const action: Action = {
          _id: this.id('ACTION'),
          methodId: 'process:method:CreateToDo',
          context: { _id: contextId },
          params: {
            title,
            user: createContext({ type: 'attribute', key: users.name }),
            completionMode: task.completion,
            withRollback: task.rollback
          }
        }
        contextDefinitions[contextId] = {
          name: task.contextLabel === undefined ? title : text(task.contextLabel, `${at}.task.contextLabel`),
          _class: 'process:class:ProcessToDo',
          action: action._id,
          index: Object.keys(contextDefinitions).length + 1,
          producer: transitionId,
          value: { type: 'context', id: contextId, key: '' }
        }
        return action
      })
    }
    const add = (from: string | null, value: unknown, path: string): void => {
      const transition = object(value, path, from === null ? ['to', 'actions'] : ['on', 'to', 'actions'])
      let trigger = 'OnExecutionStart'
      let params: Record<string, unknown> = {}
      if (from !== null) {
        const on = object(transition.on, `${path}.on`, ['changed', 'tasksCompleted', 'matches'])
        if (Object.keys(on).length !== 1) fail(`${path}.on`, 'Specify exactly one trigger')
        if (on.changed !== undefined) {
          const field = this.getField(text(on.changed, `${path}.on.changed`), `${path}.on.changed`)
          trigger = 'WhenFieldChanges'
          params = { [field.name]: { $exists: true } }
        } else if (on.matches !== undefined) {
          trigger = 'OnCardUpdate'
          params = compileMatch(on.matches, this.fields, `${path}.on.matches`)
        } else {
          const key = text(on.tasksCompleted, `${path}.on.tasksCompleted`)
          if (contexts[key] === undefined) {
            fail(`${path}.on.tasksCompleted`, `Task context "${key}" must be produced before this transition`)
          }
          trigger = 'OnToDoClose'
          params = { _id: createContext({ type: 'context', id: contexts[key] as ContextId, key: '' }) }
        }
      }
      const native = this.transition(
        definition._id,
        from,
        resolveState(transition.to, `${path}.to`),
        trigger,
        params,
        []
      )
      native.actions = actions(transition.actions, `${path}.actions`, native._id)
    }
    add(null, raw.start, `${path}.start`)
    for (const [key, value] of Object.entries(stateData)) {
      const state = object(value, `${path}.states.${key}`)
      for (const [index, transition] of list(state.transitions ?? [], `${path}.states.${key}.transitions`).entries()) {
        add(states[key]._id, transition, `${path}.states.${key}.transitions[${index}]`)
      }
    }
    definition.context = contextDefinitions
    this.validateGraph(definition._id, states, contextDefinitions, path)
  }

  validateGraph (
    process: string,
    states: Record<string, AuthoringNativeDocument>,
    contexts: Record<string, unknown>,
    path = 'process'
  ): void {
    const transitions = this.docs.filter((doc) => doc._class === 'process:class:Transition' && doc.process === process)
    const start = transitions.find((transition) => transition.from === null)
    const reachable = new Set<string>()
    const visit = (id: string): void => {
      if (reachable.has(id)) return
      reachable.add(id)
      for (const transition of transitions) if (transition.from === id) visit(String(transition.to))
    }
    if (start !== undefined) visit(String(start.to))
    for (const [key, state] of Object.entries(states)) {
      if (!reachable.has(state._id)) fail(`${path}.states.${key}`, 'State is unreachable from start')
    }
    const active = new Set<string>()
    const done = new Set<string>()
    const automatic = (id: string): void => {
      if (active.has(id)) {
        fail(`${path}.states`, 'Automatic match transitions form a cycle; use an event-driven waiting state')
      }
      if (done.has(id)) return
      active.add(id)
      for (const transition of transitions) {
        if (transition.from === id && transition.trigger === 'process:trigger:OnCardUpdate') {
          automatic(String(transition.to))
        }
      }
      active.delete(id)
      done.add(id)
    }
    for (const state of Object.values(states)) automatic(state._id)
    for (const consumer of transitions.filter((transition) => transition.trigger === 'process:trigger:OnToDoClose')) {
      const params = consumer.triggerParams as Record<string, string>
      const context = Object.entries(contexts).find(
        ([id]) => params._id === createContext({ type: 'context', id: id as ContextId, key: '' })
      )?.[1]
      if (context === undefined) fail(`${path}.states`, 'Missing task context definition')
      const producer = (context as { producer: string }).producer
      if (start?._id === producer) continue
      const visited = new Set<string>()
      const withoutProducer = (state: string): boolean => {
        if (state === consumer.from) return true
        if (visited.has(state)) return false
        visited.add(state)
        return transitions.some(
          (transition) =>
            transition.from === state && transition._id !== producer && withoutProducer(String(transition.to))
        )
      }
      if (start !== undefined && withoutProducer(String(start.to))) {
        fail(`${path}.states`, 'A task completion transition can be reached without its producing task action')
      }
    }
  }

  compileProcess (value: unknown, owner: string, path: string): AuthoringNativeDocument {
    const data = object(value, path, [
      'key',
      'label',
      'description',
      'autoStart',
      'showInHeader',
      'parallelExecutionForbidden',
      'automationOnly',
      'slots',
      'calculations',
      'start',
      'states'
    ])
    if (data.key !== undefined) identifier(data.key, `${path}.key`)
    if (!this.portable && data.slots !== undefined) {
      fail(`${path}.slots`, 'Embedded processes reference local fields; standalone templates declare slots')
    }
    if (this.portable) this.readFields(data.slots, `${path}.slots`, owner)
    const definition = this.definition(data, owner, path)
    if (this.portable) {
      definition.requiredSlots = Object.fromEntries(
        Object.entries(this.fields).map(([key, field]) => [
          key,
          {
            slotKind: 'attribute',
            _class: core.class.Attribute,
            name: key,
            label: getEmbeddedLabel(field.label),
            type: field.nativeType,
            ...(field.choices !== undefined ? { enumValues: field.choices } : {})
          }
        ])
      )
    }
    if (data.calculations !== undefined) {
      if (data.start !== undefined || data.states !== undefined) {
        fail(path, 'Use either calculations or an explicit graph')
      }
      this.compileCalculations(
        definition,
        this.calculations(object(data.calculations, `${path}.calculations`), `${path}.calculations`)
      )
    } else {
      this.compileGraph(definition, data, path)
    }
    return definition
  }
}

/** Compiles versioned YAML authoring documents into native card modules or portable process templates. */
export function compileProcessYaml (source: string, model?: ModelDb): ProcessAuthoringResult {
  if (source.length > 1024 * 1024 || new TextEncoder().encode(source).byteLength > 1024 * 1024) {
    fail('$', 'Authoring document exceeds 1 MiB')
  }
  const locations = new AuthoringSource(source)
  let value: unknown
  try {
    value = load(source, { schema: JSON_SCHEMA, listener: locations.listener })
  } catch (error) {
    if (error instanceof YAMLException) {
      throw new ProcessAuthoringError(
        '$',
        error.message,
        error.mark?.line === undefined ? undefined : error.mark.line + 1,
        error.mark?.column === undefined ? undefined : error.mark.column + 1
      )
    }
    throw error
  }
  try {
    return compileAuthoringRoot(value, model)
  } catch (error) {
    if (error instanceof ProcessAuthoringError && error.line === undefined) {
      const mark = locations.location(value, error.path)
      if (mark !== undefined) {
        throw new ProcessAuthoringError(error.path, error.message.slice(error.path.length + 2), mark.line, mark.column)
      }
    }
    throw error
  }
}

function compileAuthoringRoot (value: unknown, model?: ModelDb): ProcessAuthoringResult {
  assertTree(value)
  const root = object(value, '$')
  if (root.version === 2) return { ...compileAuthoringModel(root, model), version: 2 }
  object(root, '$', ['version', 'kind', 'card', 'process'])
  if (root.version !== 1) fail('version', 'Supported authoring versions: 1 and 2')
  if (root.kind !== 'card' && root.kind !== 'process') fail('kind', 'Expected card or process')
  if (root.kind === 'process' && root.card !== undefined) fail('card', 'A process template cannot declare a card')
  if (root.kind === 'card' && root.process !== undefined) {
    fail('process', 'Embedded processes belong under card.processes')
  }
  const compiler = new Compiler(root.kind === 'process')
  if (root.kind === 'process') {
    compiler.compileProcess(root.process, '__MASTER_TAG__', 'process')
  } else {
    const data = object(root.card, 'card', [
      'key',
      'label',
      'description',
      'icon',
      'background',
      'color',
      'fields',
      'processes'
    ])
    identifier(data.key, 'card.key')
    const owner = compiler.add(card.class.MasterTag, {
      extends: card.class.Card,
      kind: ClassifierKind.CLASS,
      icon: data.icon === undefined ? card.icon.MasterTag : text(data.icon, 'card.icon'),
      label: getEmbeddedLabel(text(data.label, 'card.label')),
      ...(data.background !== undefined ? { background: finiteNumber(data.background, 'card.background') } : {}),
      ...(data.color !== undefined ? { color: text(data.color, 'card.color') } : {}),
      ...(data.description !== undefined ? { description: text(data.description, 'card.description') } : {})
    })._id
    compiler.readFields(data.fields, 'card.fields', owner)
    const calculations = Object.fromEntries(
      Object.entries(compiler.fields)
        .filter(([, field]) => field.calculation !== undefined)
        .map(([key, field]) => [key, field.calculation])
    )
    if (Object.keys(calculations).length > 0) {
      const definition = compiler.definition({ label: 'Recalculate fields', autoStart: true }, owner)
      compiler.compileCalculations(definition, compiler.calculations(calculations))
    }
    for (const [key, process] of Object.entries(object(data.processes ?? {}, 'card.processes'))) {
      identifier(key, `card.processes.${key}`)
      compiler.compileProcess(process, owner, `card.processes.${key}`)
    }
  }
  return {
    kind: root.kind,
    docs: compiler.docs,
    fields: Object.fromEntries(Object.entries(compiler.fields).map(([key, field]) => [key, field.name]))
  }
}

function finiteNumber (value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'Expected a finite number')
  return value
}

/** Reads existing native JSON unchanged, or compiles YAML for the requested import route. */
export function parseProcessImport (source: string, kind: 'card' | 'process', model?: ModelDb): Doc[] {
  if (source.trimStart().startsWith('[')) return JSON.parse(source) as Doc[]
  const result = compileProcessYaml(source, model)
  if (result.kind !== kind) {
    fail('kind', `Use the ${result.kind === 'card' ? 'card module' : 'process'} importer for this document`)
  }
  return result.docs as unknown as Doc[]
}

/** Validates source for the authoring UI without writing model documents. */
export function validateProcessYaml (source: string, kind?: 'card' | 'process', model?: ModelDb): AuthoringValidation {
  try {
    const result = compileProcessYaml(source, model)
    if (kind !== undefined && result.kind !== kind) fail('kind', `Expected a ${kind} definition in this editor`)
    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      diagnostic: {
        message: error instanceof Error ? error.message : String(error),
        path: error instanceof ProcessAuthoringError ? error.path : '$',
        ...(error instanceof ProcessAuthoringError ? { line: error.line, column: error.column } : {})
      }
    }
  }
}
