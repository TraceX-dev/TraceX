// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { default: core, TxFactory } = require('@hcengineering/core')
const { compileProcessYaml, exportProcessYaml } = require('@hcengineering/process')

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn(async (id) => jest.requireActual('../transform')[id.split(':').at(-1)])
}))

const { getContextValue } = require('../utils')
const { MatchCardCheck, FieldChangedCheck, UpdateCard } = require('../functions')
const source = readFileSync(
  resolve(__dirname, '../../../../plugins/process/docs/examples/risk-management-reactive.card.yaml'), 'utf8'
)
const original = compileProcessYaml(source)
const compiled = compileProcessYaml(exportProcessYaml(original.docs, 'card'))
const model = new Map(compiled.docs.map((doc) => [doc._id, doc]))
const definitions = compiled.docs.filter((doc) => doc._class === 'process:class:Process')
const attributes = compiled.docs.filter((doc) => doc._class === core.class.Attribute)
const transitions = compiled.docs.filter((doc) => doc._class === 'process:class:Transition')
const probabilityChoices = model.get('rr_probability_scale').enumValues
const severityChoices = model.get('rr_severity_scale').enumValues
const A = 'Acceptable'
const T = 'Tolerable'
const U = 'Unacceptable'

// This literal business table is the independent oracle; do not derive it from the YAML formula.
const matrix = [
  [A, A, A, A, T],
  [A, A, A, T, T],
  [A, A, T, T, U],
  [A, T, T, U, U],
  [A, T, U, U, U]
]
const pairs = matrix.flatMap((row, p) => row.map((expected, s) => [p + 1, s + 1, expected]))
const startOrders = [
  ['normalize_risk', 'sum_risk', 'classify_risk'],
  ['normalize_risk', 'classify_risk', 'sum_risk'],
  ['sum_risk', 'normalize_risk', 'classify_risk'],
  ['sum_risk', 'classify_risk', 'normalize_risk'],
  ['classify_risk', 'normalize_risk', 'sum_risk'],
  ['classify_risk', 'sum_risk', 'normalize_risk']
]

// The harness dispatches native update operations, including equal-value writes, to every started process.
// It runs actual predicates, context transforms and UpdateCard, not a second implementation of the formula.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function runtime (p = 1, s = 1) {
  const card = {
    _id: 'reactive-risk-card', _class: 'reactive_risk', space: 'cards',
    probability: probabilityChoices[p - 1], severity: severityChoices[s - 1]
  }
  const executions = new Map()
  const events = []
  const writes = []
  const factory = new TxFactory(core.account.System)
  let totalSteps = 0
  let maxImmediateSteps = 0

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function control () {
    return {
      cache: new Map([[card._id, card]]),
      client: {
        txFactory: factory,
        getModel: () => ({ findObject: (id) => model.get(id) ?? { _id: id } }),
        getHierarchy: () => ({
          isMixin: () => false,
          findAttribute: (_, key) => attributes.find((attr) => attr.name === key),
          getBaseClass: (clazz) => clazz,
          isDerived: (clazz, parent) => clazz === parent,
          hasMixin: () => true,
          as: (doc) => ({ func: doc._id })
        })
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function broadcast (operations) {
    for (const processId of executions.keys()) {
      events.push({ processId, operations: structuredClone(operations), card: structuredClone(card) })
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function advance (processId, event, operations = {}, eventCard = card) {
    const execution = executions.get(processId)
    const native = control()
    const candidates = transitions.filter((item) => item.process === processId && item.from === execution.currentState)
    let transition = candidates.find((item) => item.trigger === event && (
      event === 'process:trigger:OnExecutionStart' ||
      (event === 'process:trigger:WhenFieldChanges'
        ? FieldChangedCheck(native, execution, item.triggerParams, { card: eventCard, operations })
        : MatchCardCheck(native, execution, item.triggerParams, { card: eventCard }))
    ))
    let immediateSteps = 0
    while (transition !== undefined) {
      if (++immediateSteps > 100 || ++totalSteps > 1000) throw new Error('Reactive execution did not settle')
      for (const action of transition.actions) {
        if (action.methodId !== 'process:method:UpdateCard') throw new Error(`Unexpected action: ${action.methodId}`)
        const params = await getContextValue(structuredClone(action.params), native, execution)
        const result = await UpdateCard(params, execution, native)
        for (const tx of result.txes) {
          Object.assign(card, tx.operations)
          native.cache.set(card._id, card)
          writes.push({ processId, operations: structuredClone(tx.operations) })
          broadcast(tx.operations)
        }
      }
      execution.currentState = transition.to
      transition = transitions.find((item) =>
        item.process === processId && item.from === execution.currentState &&
        item.trigger === 'process:trigger:OnCardUpdate' &&
        MatchCardCheck(native, execution, item.triggerParams, { card })
      )
    }
    maxImmediateSteps = Math.max(maxImmediateSteps, immediateSteps)
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function drain (policy = 'fifo') {
    let deliveries = 0
    while (events.length > 0) {
      if (++deliveries > 1000) throw new Error('Output writes created an event cycle')
      const next = policy === 'lifo' ? events.pop() : events.shift()
      // The native card-update event offers both checks. A field-change transition takes priority here;
      // automatic card predicates also let a process waiting for readiness resume after any card update.
      await advance(next.processId, 'process:trigger:WhenFieldChanges', next.operations, next.card)
      await advance(next.processId, 'process:trigger:OnCardUpdate', next.operations, card)
    }
    return deliveries
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function start (order, policy = 'fifo') {
    for (const processId of order) {
      executions.set(processId, { card: card._id, process: processId, currentState: null, context: {} })
      await advance(processId, 'process:trigger:OnExecutionStart')
      await drain(policy)
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function edit (operations, policy = 'fifo') {
    Object.assign(card, operations)
    broadcast(operations)
    await drain(policy)
  }

  return {
    card, executions, writes, start, edit, drain,
    stats: () => ({ pending: events.length, totalSteps, maxImmediateSteps })
  }
}

describe('default Risk management example through native operations', () => {
  test('defines three independent responsibilities and exactly three hidden numeric service fields', () => {
    expect(definitions.map((doc) => doc._id)).toEqual(['normalize_risk', 'sum_risk', 'classify_risk'])
    const numeric = attributes.filter((attr) => attr.type._class === core.class.TypeNumber)
    expect(numeric).toHaveLength(3)
    for (const attr of numeric) expect(attr).toMatchObject({ hidden: true, readonly: true, automationOnly: true })
    expect(attributes.filter((attr) => !attr.hidden).map((attr) => attr.name)).toEqual(['probability', 'severity', 'risk_level'])
    expect(transitions.flatMap((item) => item.actions).every((action) => action.methodId === 'process:method:UpdateCard')).toBe(true)
    const observed = Object.fromEntries(definitions.map((definition) => [definition._id, transitions
      .filter((item) => item.process === definition._id && item.trigger === 'process:trigger:WhenFieldChanges')
      .flatMap((item) => Object.keys(item.triggerParams))]))
    expect(observed).toEqual({
      normalize_risk: ['probability', 'severity'],
      sum_risk: ['probability_number', 'severity_number'],
      classify_risk: ['severity_number', 'risk_sum']
    })
    expect(source).not.toMatch(/RunSubProcess|fallback|snapshot|\$in:/)
  })

  describe.each(['fifo', 'lifo'])('%s update delivery', (policy) => {
    test.each(pairs)('matches the decision table for P=%i, S=%i -> %s in all six start orders', async (p, s, expected) => {
      for (const order of startOrders) {
        const state = runtime(p, s)
        await state.start(order, policy)
        expect(state.card).toMatchObject({ probability_number: p, severity_number: s, risk_sum: p + s, risk_level: expected })
        expect(state.stats().pending).toBe(0)
        expect(state.stats().maxImmediateSteps).toBeLessThanOrEqual(2)
        expect(state.stats().totalSteps).toBeLessThan(50)
        for (const execution of state.executions.values()) expect(execution.currentState).toMatch(/_wait$/)
      }
    })

    test.each(startOrders.map((order) => [order]))('recomputes each input independently with start order %p', async (order) => {
      const state = runtime()
      await state.start(order, policy)
      for (let s = 1; s <= 5; s++) {
        await state.edit({ severity: severityChoices[s - 1] }, policy)
        for (let p = 1; p <= 5; p++) {
          await state.edit({ probability: probabilityChoices[p - 1] }, policy)
          expect(state.card.risk_sum).toBe(p + s)
          expect(state.card.risk_level).toBe(matrix[p - 1][s - 1])
        }
      }
      for (let p = 1; p <= 5; p++) {
        await state.edit({ probability: probabilityChoices[p - 1] }, policy)
        for (let s = 1; s <= 5; s++) {
          await state.edit({ severity: severityChoices[s - 1] }, policy)
          expect(state.card.risk_level).toBe(matrix[p - 1][s - 1])
        }
      }
      const steps = state.stats().totalSteps
      await state.edit({ risk_level: state.card.risk_level }, policy)
      expect(state.stats().totalSteps).toBe(steps)
      expect(await state.drain(policy)).toBe(0)
    })

    test('preserves 1/5 <-> 5/1 asymmetry when the aggregate does not change', async () => {
      const state = runtime(1, 5)
      await state.start(startOrders[5], policy)
      expect(state.card).toMatchObject({ risk_sum: 6, risk_level: T })
      await state.edit({ probability: probabilityChoices[4], severity: severityChoices[0] }, policy)
      expect(state.card).toMatchObject({ risk_sum: 6, risk_level: A })
      await state.edit({ probability: probabilityChoices[0], severity: severityChoices[4] }, policy)
      expect(state.card).toMatchObject({ risk_sum: 6, risk_level: T })
      expect(state.stats().pending).toBe(0)
    })

    test('severity alone invalidates classification without a sum update event', async () => {
      const state = runtime(1, 5)
      state.card.severity_number = 5
      state.card.risk_sum = 6
      await state.start(['classify_risk'], policy)
      expect(state.card.risk_level).toBe(T)
      await state.edit({ severity_number: 1 }, policy)
      expect(state.card).toMatchObject({ risk_sum: 6, risk_level: A })
      await state.edit({ severity_number: 5 }, policy)
      expect(state.card).toMatchObject({ risk_sum: 6, risk_level: T })
      expect(state.writes.every((write) => !Object.hasOwn(write.operations, 'risk_sum'))).toBe(true)
      expect(state.stats().pending).toBe(0)
    })
  })

  test.each([undefined, null])('waits for missing/non-null inputs without converting %p to zero', async (value) => {
    const state = runtime()
    state.card.probability = value
    await state.start(startOrders[2])
    expect(state.card.probability_number).toBeUndefined()
    expect(state.card.risk_sum).toBeUndefined()
    expect(state.card.risk_level).toBeUndefined()
    await state.edit({ probability: probabilityChoices[2] })
    expect(state.card).toMatchObject({ probability_number: 3, severity_number: 1, risk_sum: 4, risk_level: A })
  })

  test.each([
    [undefined, false], [null, true], ['', true], [0, true], [false, true], [[], true], ['not an enum choice', true]
  ])('Value is set tests presence of %p, not validity', (value, expected) => {
    const definition = definitions[0]
    const card = { _id: 'card', _class: definition.masterTag, probability: value }
    const control = {
      client: {
        getModel: () => ({ findObject: (id) => model.get(id) }),
        getHierarchy: () => ({
          isMixin: () => false,
          findAttribute: () => attributes[0],
          getBaseClass: (clazz) => clazz,
          isDerived: (clazz, parent) => clazz === parent,
          hasMixin: () => true
        })
      }
    }
    const execution = { process: definition._id }
    expect(MatchCardCheck(control, execution, { probability: { $exists: true } }, { card })).toBe(expected)
    if (value === undefined) {
      delete card.probability
      expect(MatchCardCheck(control, execution, { probability: { $exists: true } }, { card })).toBe(false)
    }
  })
})
