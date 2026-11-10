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

import card, { type MasterTag, type Role } from '@hcengineering/card'
import contact from '@hcengineering/contact'
import core, {
  ClassifierKind,
  DOMAIN_MODEL,
  Hierarchy,
  ModelDb,
  generateId,
  type Client,
  type Data,
  type Doc,
  type Ref,
  type SpaceType
} from '@hcengineering/core'
import { getEmbeddedLabel } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import process, {
  bindYamlModelProcess,
  compileProcessYaml,
  createContext,
  createYamlModelTemplate,
  exportAuthoringModel,
  isAuthoringSlotBindingCompatible,
  parseContext,
  type Process,
  type ProcessFunction,
  type SlotModel,
  type State,
  type StepId,
  type Transition
} from '@hcengineering/process'
import { detectSlots, getRequiredSlots } from '../exporter'
import { createClass, createDoc, genMinModel } from './minmodel'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))

describe('process role slots', () => {
  let hierarchy: Hierarchy
  let model: ModelDb
  const roleId = '6af09463115d3e039a421a9f' as Ref<Role>
  const childCard = generateId<MasterTag>()
  const role: Partial<Role> = { _id: roleId, _class: card.class.Role, name: 'Approvers', types: [card.class.Card] }
  const definition: Partial<Process> = {
    _id: 'approval-process' as Ref<Process>,
    _class: process.class.Process,
    space: core.space.Model,
    masterTag: card.class.Card,
    name: 'Send to approvers',
    description: '',
    rank: '0',
    context: {}
  }
  const transition: Partial<Transition> = {
    _id: 'start-approval' as Ref<Transition>,
    _class: process.class.Transition,
    space: core.space.Model,
    rank: '0',
    process: definition._id,
    from: null,
    to: 'done' as Ref<State>,
    trigger: process.trigger.OnExecutionStart,
    triggerParams: {},
    actions: [
      {
        _id: 'create-task' as StepId,
        context: null,
        methodId: process.method.CreateToDo,
        params: {
          user: createContext({
            type: 'function',
            key: '',
            func: process.function.RoleContext,
            props: { target: roleId }
          }),
          title: 'Take it'
        }
      }
    ]
  }

  beforeEach(async () => {
    hierarchy = new Hierarchy()
    model = new ModelDb(hierarchy)
    const roleData: Data<Role> = {
      name: 'Approvers',
      types: [card.class.Card],
      permissions: [],
      attachedTo: generateId<SpaceType>(),
      attachedToClass: core.class.SpaceType,
      collection: 'roles'
    }
    const roleFunction: Data<ProcessFunction> = {
      type: 'context',
      of: contact.mixin.Employee,
      label: core.string.Role,
      category: 'array'
    }
    const txes = [
      ...genMinModel(),
      createClass(childCard, {
        label: getEmbeddedLabel('Approval card'),
        extends: card.class.Card,
        kind: ClassifierKind.CLASS
      }),
      createClass(card.class.Role, {
        label: getEmbeddedLabel('Role'),
        extends: core.class.Doc,
        kind: ClassifierKind.CLASS,
        domain: DOMAIN_MODEL
      }),
      createClass(process.class.ProcessFunction, {
        label: getEmbeddedLabel('Function'),
        extends: core.class.Doc,
        kind: ClassifierKind.CLASS,
        domain: DOMAIN_MODEL
      }),
      createDoc(process.class.ProcessFunction, roleFunction, process.function.RoleContext),
      createDoc(card.class.Role, roleData, roleId)
    ]
    for (const tx of txes) {
      hierarchy.tx(tx)
    }
    for (const tx of txes) {
      await model.tx(tx)
    }
  })

  it('exports the role name and class instead of an unknown object slot', () => {
    const slots: Record<string, SlotModel> = {}
    const bindings: Record<string, string> = {}
    detectSlots(definition as Process, [transition as Transition], slots, bindings, model, hierarchy)
    expect(slots).toEqual({
      Approvers: { slotKind: 'role', _class: card.class.Role, name: 'Approvers', memberOf: undefined }
    })
    expect(bindings).toEqual({ Approvers: roleId })
  })

  it('allows roles for the card type and rejects unrelated roles or objects', () => {
    const slot: SlotModel = { slotKind: 'role', _class: card.class.Role }
    const otherRole: Partial<Role> = { ...role, _id: 'other-role' as Ref<Role>, types: [card.class.Tag] }
    expect(isAuthoringSlotBindingCompatible(card.class.Card, slot, roleId, {}, model, hierarchy)).toBe(true)
    expect(
      isAuthoringSlotBindingCompatible(card.class.Card, slot, 'other-role', {}, model, hierarchy, undefined, [
        otherRole as Role
      ])
    ).toBe(false)
    expect(isAuthoringSlotBindingCompatible(card.class.Card, slot, card.class.Card, {}, model, hierarchy)).toBe(false)
  })

  it('checks inherited role types and waits for a dependent owner binding', () => {
    const slot: SlotModel = { slotKind: 'role', _class: card.class.Role, memberOf: '__SLOT_owner__' }
    expect(isAuthoringSlotBindingCompatible(card.class.Card, slot, roleId, {}, model, hierarchy)).toBe(false)
    expect(isAuthoringSlotBindingCompatible(childCard, slot, roleId, { owner: childCard }, model, hierarchy)).toBe(true)
  })

  it('round trips a role slot through YAML and rebinds the RoleContext target', () => {
    const slots: Record<string, SlotModel> = {}
    const bindings: Record<string, string> = {}
    detectSlots(definition as Process, [transition as Transition], slots, bindings, model, hierarchy)
    const native: Partial<Process> = { ...definition, requiredSlots: slots, bindings }
    const state: Partial<State> = {
      _id: 'done' as Ref<State>,
      _class: process.class.State,
      space: core.space.Model,
      process: definition._id,
      title: 'Done',
      rank: '0'
    }
    const template = createYamlModelTemplate(
      [native as Process, transition as Transition, state as Doc],
      model,
      hierarchy
    )
    const source = exportAuthoringModel(template.docs, 'process')
    expect(source).toContain('kind: role')
    expect(source).toContain('class: card.Role')
    const client: Pick<Client, 'getModel'> = { getModel: () => model }
    ;(getClient as jest.Mock).mockReturnValue(client)
    const legacy = source.replace('kind: role', 'kind: unknown').replace('class: card.Role', 'class: core.Obj')
    expect(getRequiredSlots(legacy)).toEqual({
      slot_approvers: { slotKind: 'role', _class: card.class.Role, name: 'Approvers', memberOf: undefined }
    })
    const compiled = compileProcessYaml(source)
    const rebound = bindYamlModelProcess(
      compiled.docs as unknown as Doc[],
      card.class.Card,
      { slot_approvers: 'destination-role' },
      model,
      hierarchy
    )
    const boundTransition = rebound.find((doc) => doc._class === process.class.Transition) as Transition
    expect(parseContext(boundTransition.actions[0].params.user)).toEqual(
      expect.objectContaining({ type: 'function', props: { target: 'destination-role' } })
    )
  })
})
