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
