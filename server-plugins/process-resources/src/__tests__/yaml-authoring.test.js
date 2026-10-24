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

const { default: core, TxFactory } = require('@hcengineering/core')
const path = require('path')
const fs = require('fs')

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn(async (id) => jest.requireActual('../transform')[id.split(':').at(-1)])
}))

const {
  compileProcessYaml,
  remapAuthoringReferences,
  exportProcessYaml,
  exportProcessYamlDraft
} = require('@hcengineering/process')
const { getContextValue } = require('../utils')
const { MatchCardCheck, FieldChangedCheck, SetContext, UpdateCard } = require('../functions')
const { bindYamlModelProcess } = jest.requireActual('../../../../plugins/process-resources/src/yaml-model-bindings')
const original = compileProcessYaml(
  fs.readFileSync(
    path.resolve(__dirname, '../../../../plugins/process/docs/examples/risk-management.card.yaml'),
    'utf8'
  )
)
const legacy = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../../plugins/process/docs/examples/risk-management.module.json'),
    'utf8'
  )
)
const originalProcess = original.docs.find((d) => d._class === 'process:class:Process')
const originalAttributes = original.docs.filter((d) => d._class === core.class.Attribute)
const slots = Object.fromEntries(
  originalAttributes.map((attr, index) => [
    `field${index}`,
    {
      slotKind: 'attribute',
      _class: core.class.Attribute,
      label: attr.label,
      type: attr.type
    }
  ])
)
const originalBindings = Object.fromEntries(originalAttributes.map((attr, index) => [`field${index}`, attr.name]))
const portable = exportProcessYamlDraft(
  original.docs
    .filter((d) => d._class.startsWith('process:') || d._class === core.class.Enum)
    .map((d) => (d._id === originalProcess._id ? { ...d, requiredSlots: slots, bindings: originalBindings } : d))
)
const boundProcess = {
  docs: [
    ...bindYamlModelProcess(
      compileProcessYaml(portable.source).docs,
      originalProcess.masterTag,
      portable.bindings,
      { findObject: (id) => original.docs.find((doc) => doc._id === id) },
      { findAttribute: (_, key) => originalAttributes.find((attr) => attr.name === key) }
    ),
    ...originalAttributes
  ]
}

describe.each([
  ['original YAML', original, 3],
  ['YAML export round trip', compileProcessYaml(exportProcessYaml(original.docs, 'card')), 3],
  ['legacy JSON to YAML', compileProcessYaml(exportProcessYaml(legacy, 'card')), 3],
  ['standalone YAML bound to card fields', boundProcess, 3]
])('%s native risk execution', (_, compiled, expectedSteps) => {
  const definition = compiled.docs.find((d) => d._class === 'process:class:Process')
  const attrs = compiled.docs.filter((d) => d._class === core.class.Attribute)
  const transitions = compiled.docs.filter((d) => d._class === 'process:class:Transition')
  const byLabel = Object.fromEntries(
    attrs.map((attr) => [attr.label.replace('embedded:embedded:', '').toLowerCase().replaceAll(' ', '_'), attr.name])
  )
  const fields = { ...byLabel, score: byLabel.risk_score, level: byLabel.risk_level }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- This JavaScript harness cannot use TypeScript return annotations.
  function makeExecution (probability, severity) {
    const card = {
      _id: 'risk',
      _class: definition.masterTag,
      space: 'cards',
      [fields.probability]: probability,
      [fields.severity]: severity
    }
    const execution = { card: card._id, process: definition._id, currentState: null, context: {} }
    const control = {
      cache: new Map([[card._id, card]]),
      client: {
        txFactory: new TxFactory(core.account.System),
        getModel: () => ({ findObject: (id) => (id === definition._id ? definition : { _id: id }) }),
        getHierarchy: () => ({
          isMixin: () => false,
          findAttribute: (_, key) => attrs.find((a) => a.name === key),
          getBaseClass: (clazz) => clazz,
          isDerived: (clazz, parent) => clazz === parent,
          hasMixin: () => true,
          as: (doc) => ({ func: doc._id })
        })
      }
    }
    return { card, execution, control }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- This JavaScript harness cannot use TypeScript return annotations.
  async function advance (runtime, event, operations = {}) {
    const { card, execution, control } = runtime
    const candidates = transitions.filter((t) => t.from === execution.currentState && t.trigger === event)
    let transition = candidates.find(
      (t) =>
        t.from === null ||
        (event === 'process:trigger:WhenFieldChanges'
          ? FieldChangedCheck(control, execution, t.triggerParams, { card, operations })
          : MatchCardCheck(control, execution, t.triggerParams, { card }))
    )
    let steps = 0
    while (transition) {
      if (++steps > 10) throw new Error('Unexpected automatic cycle')
      for (const action of transition.actions) {
        const params = await getContextValue(structuredClone(action.params), control, execution)
        const result = await UpdateCard(params, execution, control)
        for (const tx of result.txes) Object.assign(card, tx.operations)
      }
      execution.currentState = transition.to
      transition = transitions.find(
        (t) =>
          t.from === execution.currentState &&
          t.trigger === 'process:trigger:OnCardUpdate' &&
          MatchCardCheck(control, execution, t.triggerParams, { card })
      )
    }
    return steps
  }

  test.each(Array.from({ length: 25 }, (_, i) => [Math.floor(i / 5) + 1, (i % 5) + 1]))(
    'native functions and predicates execute the generated graph for %i × %i',
    async (p, s) => {
      const runtime = makeExecution(String(p), String(s))
      expect(await advance(runtime, 'process:trigger:OnExecutionStart')).toBe(expectedSteps)
      expect(runtime.card[fields.score]).toBe(p * s)
      expect(runtime.card[fields.level]).toBe(p * s > 16 ? 'Critical' : p * s < 9 ? 'Insignificant' : 'Moderate')
      const waiting = compiled.docs.find((d) => d._id === runtime.execution.currentState)
      expect(waiting.title).toBe('Wait for input changes')
    }
  )

  test('changing either input recalculates, computed writes do not trigger another pass', async () => {
    const runtime = makeExecution('5', '5')
    await advance(runtime, 'process:trigger:OnExecutionStart')
    runtime.card[fields.probability] = '1'
    expect(await advance(runtime, 'process:trigger:WhenFieldChanges', { [fields.probability]: '1' })).toBe(
      expectedSteps
    )
    expect(runtime.card[fields.level]).toBe('Insignificant')
    runtime.card[fields.probability] = '4'
    runtime.card[fields.severity] = '4'
    await advance(runtime, 'process:trigger:WhenFieldChanges', { [fields.severity]: '4' })
    expect(runtime.card[fields.score]).toBe(16)
    expect(runtime.card[fields.level]).toBe('Moderate')
    expect(
      await advance(runtime, 'process:trigger:WhenFieldChanges', { [fields.score]: 16, [fields.level]: 'Moderate' })
    ).toBe(0)
  })

  test.each([undefined, null, '', '0', '6', 'bad'])(
    'missing/invalid input %p waits and resumes once valid',
    async (value) => {
      const runtime = makeExecution('5', value)
      expect(await advance(runtime, 'process:trigger:OnExecutionStart')).toBe(1)
      expect(runtime.card[fields.score]).toBeUndefined()
      runtime.card[fields.severity] = '4'
      await advance(runtime, 'process:trigger:OnCardUpdate')
      expect(runtime.card[fields.score]).toBe(20)
      expect(runtime.card[fields.level]).toBe('Critical')
    }
  )
})

describe('typed YAML estimates through native value evaluation', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../../plugins/process/docs/examples/estimate-review.process.yaml'),
    'utf8'
  )
  const compiled = compileProcessYaml(source)
  const docs = remapAuthoringReferences(
    compiled.docs,
    new Map([
      ['__SLOT_cost__', 'cost'],
      ['__SLOT_status__', 'status'],
      ['__SLOT_reviewers__', 'reviewers']
    ])
  )
  const definition = docs.find((doc) => doc._class === 'process:class:Process')
  const transition = docs.find((doc) => doc._id === 'estimate_received')

  test.each([
    [0, 5],
    [1, 5],
    [10, 10],
    [10, 10.1],
    [5, 25]
  ])('evaluates collected %p × %p, initializes the result and takes the matching branch', async (effort, rate) => {
    const card = { _id: 'estimate', _class: definition.masterTag, space: 'cards' }
    const execution = {
      card: card._id,
      process: definition._id,
      currentState: 'waiting_for_estimate',
      context: { effort, rate }
    }
    const control = {
      cache: new Map([[card._id, card]]),
      client: {
        txFactory: new TxFactory(core.account.System),
        getModel: () => ({ findObject: (id) => (id === definition._id ? definition : { _id: id }) }),
        getHierarchy: () => ({
          isMixin: () => false,
          getBaseClass: (clazz) => clazz,
          findAttribute: () => undefined,
          isDerived: (clazz, parent) => clazz === parent,
          hasMixin: () => true,
          as: (doc) => ({ func: doc._id })
        })
      }
    }
    for (const action of transition.actions) {
      const params = await getContextValue(structuredClone(action.params), control, execution)
      if (action.methodId === 'process:method:SetContext') {
        const result = await SetContext(params, execution, control, action.results)
        for (const output of result.results) execution.context[output._id] = output.value
      } else {
        const result = await UpdateCard(params, execution, control)
        for (const tx of result.txes) Object.assign(card, tx.operations)
      }
    }
    expect(execution.context.total_cost).toBe(effort * rate)
    expect(card.cost).toBe(effort * rate)
    const branch = docs.find(
      (doc) => doc.from === 'classify_estimate' && MatchCardCheck(control, execution, doc.triggerParams, { card })
    )
    expect(branch.to).toBe(effort * rate > 100 ? 'expensive' : 'accepted')
    const result = await UpdateCard(
      await getContextValue(structuredClone(branch.actions[0].params), control, execution),
      execution,
      control
    )
    for (const tx of result.txes) Object.assign(card, tx.operations)
    expect(card.status).toBe(effort * rate > 100 ? 'Needs approval' : 'Accepted')
  })
})

describe('procurement module through native value evaluation', () => {
  const { docs } = compileProcessYaml(
    fs.readFileSync(
      path.resolve(__dirname, '../../../../plugins/process/docs/examples/procurement-workspace.card.yaml'),
      'utf8'
    )
  )
  const model = new Map(docs.map((doc) => [doc._id, doc]))
  const attributes = docs.filter((doc) => doc._class === core.class.Attribute)
  const transitions = docs.filter((doc) => doc._class === 'process:class:Transition')

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- This JavaScript harness cannot use TypeScript return annotations.
  function makeRuntime (processId, values, context = {}, related = []) {
    const definition = model.get(processId)
    const card = { _id: 'demo-card', _class: definition.masterTag, space: 'cards', ...values }
    const execution = { card: card._id, process: processId, currentState: null, context }
    const control = {
      cache: new Map([[card._id, card]]),
      client: {
        txFactory: new TxFactory(core.account.System),
        getModel: () => ({ findObject: (id) => model.get(id) ?? { _id: id } }),
        findAll: jest.fn(async (clazz, query) =>
          related.filter((doc) => doc._class === clazz && query._id.$in.includes(doc._id))
        ),
        getHierarchy: () => ({
          isMixin: () => false,
          findAttribute: (clazz, key) => {
            for (let owner = clazz; owner != null; owner = model.get(owner)?.extends) {
              const attr = attributes.find((attr) => attr.attributeOf === owner && attr.name === key)
              if (attr !== undefined) return attr
            }
            return undefined
          },
          getBaseClass: (clazz) => clazz,
          isDerived: (clazz, parent) => clazz === parent,
          hasMixin: () => true,
          as: (doc) => ({ func: doc._id })
        })
      }
    }
    return { card, execution, control }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- This JavaScript harness cannot use TypeScript return annotations.
  async function applyActions (runtime, actions) {
    const { card, execution, control } = runtime
    for (const action of actions) {
      const params = await getContextValue(structuredClone(action.params), control, execution)
      if (action.methodId === 'process:method:SetContext') {
        const result = await SetContext(params, execution, control, action.results)
        for (const output of result.results) execution.context[output._id] = output.value
      } else if (action.methodId === 'process:method:UpdateCard') {
        const result = await UpdateCard(params, execution, control)
        for (const tx of result.txes) Object.assign(card, tx.operations)
      } else {
        throw new Error(`Unsupported action in value-evaluation harness: ${action.methodId}`)
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- This JavaScript harness cannot use TypeScript return annotations.
  function matchingBranch (runtime, state) {
    return transitions.find(
      (transition) =>
        transition.process === runtime.execution.process &&
        transition.from === state &&
        MatchCardCheck(runtime.control, runtime.execution, transition.triggerParams, { card: runtime.card })
    )
  }

  test.each([
    [2, 499.5, 'USD', 'Approved', 999],
    [2, 500, 'USD', 'Approved', 1000],
    [2, 500.5, 'USD', 'Awaiting approval', 1001],
    [1, 0, 'USD', 'Approved', 0],
    [0, 500, 'USD', 'Invalid quote', undefined],
    [-1, 500, 'USD', 'Invalid quote', undefined],
    [2, -1, 'USD', 'Invalid quote', undefined],
    [2, 500, 'EUR', 'Invalid quote', undefined]
  ])('quote %p × %p %s produces %s', async (quantity, price, currency, status, amount) => {
    const runtime = makeRuntime(
      'pc_purchase_review',
      { currency, products: ['product-a', 'product-b'] },
      { pc_quote_quantity: quantity, pc_quote_unit_price: price }
    )
    await applyActions(runtime, model.get('pc_purchase_quote_received').actions)
    const validation = matchingBranch(runtime, 'pc_purchase_validate_quote')
    expect(validation).toBeDefined()
    await applyActions(runtime, validation.actions)
    if (validation.to === 'pc_purchase_check_budget') {
      const budget = matchingBranch(runtime, validation.to)
      // Creating task/approval documents is exercised manually in the walkthrough.
      await applyActions(runtime, budget.actions.slice(0, 1))
      expect(runtime.card.approval_required).toBe(amount > 1000)
      expect(runtime.card.product_count).toBe(2)
      expect(runtime.execution.context.pc_quote_amount).toBe(amount)
    }
    expect(runtime.card.amount).toBe(amount)
    expect(runtime.card.status).toBe(status)
  })

  test.each([true, false])('inspection preserves the boolean %p and takes its own branch', async (passed) => {
    const runtime = makeRuntime(
      'pc_delivery_inspection',
      {},
      {
        pc_inspected_quantity: 2,
        pc_inspection_passed: passed
      }
    )
    await applyActions(runtime, model.get('pc_delivery_inspection_received').actions)
    const decision = matchingBranch(runtime, 'pc_delivery_classify_inspection')
    await applyActions(runtime, decision.actions)
    expect(runtime.card.accepted_quantity).toBe(2)
    expect(runtime.card.inspection_passed).toBe(passed)
    expect(runtime.card.status).toBe(passed ? 'Accepted' : 'Rejected')
  })

  test.each(['Approved', 'Draft', 'Rejected', 'Invalid quote'])(
    'invoice snapshots the referenced %s request before choosing its branch',
    async (status) => {
      const request = {
        _id: 'request-1',
        _class: 'pc_request',
        title: 'Laptop purchase',
        status,
        supplier: 'supplier-1'
      }
      const runtime = makeRuntime('pc_invoice_approval', { purchase_request: request._id }, {}, [request])
      await applyActions(runtime, model.get('pc_invoice_start').actions)
      expect(runtime.card).toEqual(
        expect.objectContaining({
          request_title: request.title,
          request_status: status,
          supplier: request.supplier
        })
      )
      expect(runtime.control.client.findAll).toHaveBeenCalledWith('pc_request', { _id: { $in: [request._id] } })
      const decision = matchingBranch(runtime, 'pc_invoice_check_request')
      expect(decision.to).toBe(status === 'Approved' ? 'pc_invoice_waiting_approval' : 'pc_invoice_blocked')
      await applyActions(runtime, decision.actions.slice(0, 1))
      expect(runtime.card.status).toBe(status === 'Approved' ? 'Awaiting approval' : 'Blocked')
    }
  )
})
