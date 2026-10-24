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
// See the License for the specific language governing permissions and
// limitations under the License.
//

import card from '@hcengineering/card'
import core, { matchQuery, TxFactory, TxProcessor } from '@hcengineering/core'
import type { Class, Doc, DocumentQuery, Hierarchy, Ref, TxCreateDoc } from '@hcengineering/core'
import process, { createContext, ExecutionStatus } from '@hcengineering/process'
import type { Execution, ExecutionReason, MethodParams, SelectedRelation } from '@hcengineering/process'
import { reportProcessDiagnostic, type ProcessControl } from '@hcengineering/server-process'
import {
  ApproveRequestApproved,
  ApproveRequestRejected,
  CheckSubProcessesDone,
  CheckSubProcessMatch,
  CheckToDoDone,
  MatchCardCheck,
  RequiredFieldsFilledCheck,
  RunSubProcess
} from '../functions'
import { getContextValue } from '../utils'

const execution = {
  _id: 'parent',
  process: 'process',
  card: 'request',
  space: core.space.Workspace
} as unknown as Execution

function fixture (documents: Array<Record<string, unknown>>): {
  control: ProcessControl
  reasons: ExecutionReason[]
  findAll: jest.Mock
} {
  const hierarchy = {
    getBaseClass: (clazz: string) => clazz,
    isDerived: (clazz: string, base: string) => clazz === base,
    isMixin: () => false,
    findAttribute: () => undefined
  } as unknown as Hierarchy
  const reasons: ExecutionReason[] = []
  const findAll = jest.fn(async (clazz: Ref<Class<Doc>>, query: DocumentQuery<Doc>) =>
    matchQuery(documents.filter((doc) => doc._class === clazz) as unknown as Doc[], query, clazz, hierarchy)
  )
  const control = {
    diagnostics: (reason: ExecutionReason) => {
      reasons.push(reason)
    },
    client: { findAll, getHierarchy: () => hierarchy }
  } as unknown as ProcessControl
  return { control, reasons, findAll }
}

function child (id: string, card: string, status: ExecutionStatus, state = 'review'): Record<string, unknown> {
  return {
    _id: id,
    _class: process.class.Execution,
    parentId: execution._id,
    process: 'review-process',
    card,
    status,
    currentState: state
  }
}

describe('subprocess evidence', () => {
  it('reports the exact children across different cards and excludes unrelated executions', async () => {
    const { control, reasons, findAll } = fixture([
      child('contract-review', 'contract', ExecutionStatus.Active),
      child('specification-review', 'specification', ExecutionStatus.Done),
      child('cancelled-review', 'other-contract', ExecutionStatus.Cancelled),
      { ...child('foreign-review', 'private-contract', ExecutionStatus.Active), parentId: 'other-parent' }
    ])
    expect(await CheckSubProcessesDone(control, execution)).toBe(false)
    expect(findAll).toHaveBeenCalledTimes(1)
    expect(reasons).toEqual([
      expect.objectContaining({
        code: 'subprocesses-inactive',
        mode: 'all',
        total: 3,
        matched: 2,
        dependencies: [
          { _id: 'contract-review', _class: process.class.Execution, matched: false },
          { _id: 'specification-review', _class: process.class.Execution, matched: true },
          { _id: 'cancelled-review', _class: process.class.Execution, matched: true }
        ]
      })
    ])
    expect(JSON.stringify(reasons)).not.toContain('private-contract')
  })

  it.each([
    { predicate: '$all', mode: 'all', result: false },
    { predicate: '$in', mode: 'any', result: true },
    { predicate: '$nin', mode: 'none', result: false }
  ])('uses the same $mode set and decision as the native state predicate', async ({ predicate, mode, result }) => {
    const { control, reasons } = fixture([
      child('ready', 'contract', ExecutionStatus.Done, 'approved'),
      child('waiting', 'specification', ExecutionStatus.Active),
      child('cancelled', 'other-contract', ExecutionStatus.Cancelled, 'approved'),
      { ...child('other-process', 'contract', ExecutionStatus.Active), process: 'other-process' }
    ])
    expect(
      await CheckSubProcessMatch(
        control,
        execution,
        {
          process: 'review-process',
          currentState: { [predicate]: ['approved'] }
        },
        {}
      )
    ).toBe(result)
    expect(reasons[0]).toMatchObject({
      code: 'subprocess-state',
      mode,
      total: 2,
      matched: 1,
      dependencies: [
        { _id: 'ready', matched: true },
        { _id: 'waiting', matched: false }
      ]
    })
  })

  it('distinguishes missing matches from an unfinished child', async () => {
    const { control, reasons } = fixture([])
    expect(
      await CheckSubProcessMatch(
        control,
        execution,
        {
          process: 'review-process',
          currentState: { $all: ['approved'] }
        },
        {}
      )
    ).toBe(false)
    expect(reasons[0].code).toBe('subprocesses-missing')
  })

  it('preserves the existing no-active-child semantics for cancelled and absent children', async () => {
    for (const documents of [[], [child('cancelled', 'contract', ExecutionStatus.Cancelled)]]) {
      const { control } = fixture(documents)
      expect(await CheckSubProcessesDone(control, execution)).toBe(true)
    }
  })

  it('keeps launch provenance and waits for the actual children selected through a bound relation', async () => {
    const documents: Array<Record<string, unknown>> = [
      {
        _id: 'link-contract',
        _class: core.class.Relation,
        association: 'documents',
        docA: execution.card,
        docB: 'contract'
      },
      {
        _id: 'link-specification',
        _class: core.class.Relation,
        association: 'documents',
        docA: execution.card,
        docB: 'specification'
      },
      { _id: 'contract', _class: card.class.Card },
      { _id: 'specification', _class: card.class.Card }
    ]
    const { control, reasons } = fixture(documents)
    const selector = {
      type: 'relation',
      association: 'documents-slot',
      direction: 'B',
      key: '_id',
      name: 'Documents'
    } as unknown as SelectedRelation
    const definitions: Record<string, object> = {
      process: { masterTag: card.class.Card, bindings: { 'documents-slot': 'documents' } },
      documents: { _id: 'documents', classA: card.class.Card, classB: card.class.Card, type: 'N:N' },
      'review-process': { _id: 'review-process' }
    }
    const originalClient = control.client
    control.client = {
      findAll: originalClient.findAll.bind(originalClient),
      getHierarchy: originalClient.getHierarchy.bind(originalClient),
      txFactory: new TxFactory(core.account.System),
      getModel: () => ({ findObject: (id: string) => definitions[id] })
    } as unknown as ProcessControl['client']
    control.cache = new Map()
    control.inputSources = { card: selector }
    const cards = await getContextValue(createContext(selector), control, execution)
    const params: MethodParams<Execution> = { _id: 'review-process', card: cards }
    const result = await RunSubProcess(params, execution, control)
    if (!('txes' in result)) throw new Error('Expected subprocess creation')
    const children = result.txes.map((tx) => TxProcessor.createDoc2Doc(tx as TxCreateDoc<Execution>))
    expect(children.map((child) => child.card)).toEqual(['contract', 'specification'])
    expect(children.map((child) => child.source)).toEqual([
      { card: execution.card, association: 'documents', direction: 'B', field: undefined },
      { card: execution.card, association: 'documents', direction: 'B', field: undefined }
    ])
    documents.push(...children.map((child) => ({ ...child })))
    // Editing the relation after launch does not replace the executions that the parent actually checks.
    documents.splice(0, 1)
    expect(await CheckSubProcessesDone(control, execution)).toBe(false)
    expect(reasons[0].dependencies?.map((dependency) => dependency._id)).toEqual(children.map((child) => child._id))
  })
})

describe('task and approval evidence', () => {
  it.each(['all', 'any'] as const)('reports only the selected task group in %s mode', async (mode) => {
    const { control, reasons } = fixture([
      {
        _id: 'one',
        _class: process.class.ProcessToDo,
        execution: execution._id,
        group: 'group',
        doneOn: 1,
        completionMode: mode
      },
      {
        _id: 'two',
        _class: process.class.ProcessToDo,
        execution: execution._id,
        group: 'group',
        doneOn: null,
        completionMode: mode
      },
      { _id: 'unrelated', _class: process.class.ProcessToDo, execution: execution._id, group: 'other', doneOn: null }
    ])
    expect(await CheckToDoDone(control, execution, { _id: 'group' }, {})).toBe(mode === 'any')
    expect(reasons[0]).toMatchObject({ code: 'tasks', mode, total: 2, matched: 1 })
    expect(reasons[0].dependencies?.map((dep) => dep._id)).toEqual(['one', 'two'])
  })

  it('reports approval and rejection independently without copying private task contents', async () => {
    const { control, reasons } = fixture([
      {
        _id: 'yes',
        _class: process.class.ApproveRequest,
        execution: execution._id,
        group: 'group',
        approved: true,
        description: 'private-description'
      },
      { _id: 'no', _class: process.class.ApproveRequest, execution: execution._id, group: 'group', approved: false }
    ])
    expect(await ApproveRequestApproved(control, execution, { _id: 'group' }, {})).toBe(false)
    expect(await ApproveRequestRejected(control, execution, { _id: 'group' }, {})).toBe(true)
    expect(reasons.map((reason) => [reason.code, reason.mode, reason.matched])).toEqual([
      ['approvals', 'all', 1],
      ['rejections', 'any', 1]
    ])
    expect(JSON.stringify(reasons)).not.toContain('private-description')
  })

  it('cannot change a decision when the optional observer fails', async () => {
    const { control } = fixture([child('ready', 'contract', ExecutionStatus.Done)])
    control.diagnostics = () => {
      throw new Error('Observer unavailable')
    }
    expect(await CheckSubProcessesDone(control, execution)).toBe(true)
    expect(() => {
      reportProcessDiagnostic(control, () => {
        throw new Error('Evidence unavailable')
      })
    }).not.toThrow()
  })
})

describe('field conditions', () => {
  it('identifies failed bound fields without storing their values', () => {
    const reasons: ExecutionReason[] = []
    const control = {
      diagnostics: (reason: ExecutionReason) => {
        reasons.push(reason)
      },
      client: {
        getModel: () => ({ findObject: () => ({ masterTag: card.class.Card, bindings: { amount: 'cost' } }) }),
        getHierarchy: () => ({
          isMixin: () => false,
          findAttribute: () => undefined,
          getBaseClass: (clazz: string) => clazz,
          isDerived: (clazz: string, base: string) => clazz === base
        })
      }
    } as unknown as ProcessControl
    expect(
      MatchCardCheck(
        control,
        execution,
        { amount: { $gt: 100 }, count: { $gt: 0 } },
        {
          card: { _class: card.class.Card, cost: 80, count: 2 }
        }
      )
    ).toBe(false)
    expect(reasons[0]).toMatchObject({ code: 'card-condition', fields: ['cost'] })
    expect(JSON.stringify(reasons)).not.toContain('80')
  })

  it('treats zero and false as present values and names only missing required fields', () => {
    const reasons: ExecutionReason[] = []
    const attributes = new Map(['amount', 'accepted', 'supplier'].map((key) => [key, { required: true }]))
    const control = {
      diagnostics: (reason: ExecutionReason) => {
        reasons.push(reason)
      },
      client: {
        getModel: () => ({ findObject: () => ({ masterTag: card.class.Card }) }),
        getHierarchy: () => ({ isMixin: () => false, getAllAttributes: () => attributes })
      }
    } as unknown as ProcessControl
    expect(RequiredFieldsFilledCheck(control, execution, {}, { card: { amount: 0, accepted: false } })).toBe(false)
    expect(reasons[0]).toMatchObject({ code: 'required-fields', fields: ['supplier'] })
  })
})
