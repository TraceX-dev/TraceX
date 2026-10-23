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

import process from '@hcengineering/process'
import type { Execution, ExecutionReason, Transition } from '@hcengineering/process'
import type { ProcessControl } from '@hcengineering/server-process'
import { copyExecutionReason, createExecutionDiagnostics } from '../diagnostics'

it('bounds extension evidence, strips document contents and terminates recursive reasons', () => {
  const reason: ExecutionReason = {
    code: 'recursive', message: process.string.DiagnosticCondition,
    total: 1000,
    dependencies: Array.from({ length: 1000 }, (_, index) => ({
      _id: String(index) as Execution['_id'], _class: process.class.Execution,
      description: 'private', context: { secret: 'private' }
    }))
  }
  reason.children = Array.from({ length: 20 }, () => reason)
  const copy = copyExecutionReason(reason)
  expect(copy.dependencies).toHaveLength(200)
  expect(copy.total).toBe(1000)
  expect(JSON.stringify(copy)).not.toContain('private')
  expect(JSON.stringify(copy).length).toBeLessThan(150000)
})

it('does not turn untested alternatives into failed conditions or reuse old-state evidence', () => {
  const event = { _id: 'event', trigger: 'event-trigger' } as unknown as Transition
  const condition = { _id: 'condition', trigger: 'auto-trigger' } as unknown as Transition
  const control = {
    client: {
      getModel: () => ({
        findAllSync: () => [event, condition],
        findObject: (id: string) => ({ auto: id === 'auto-trigger' })
      })
    }
  } as unknown as ProcessControl
  const execution = {
    currentState: 'current', diagnostics: { state: 'old', checks: [{ status: 'waiting' }] }
  } as unknown as Execution
  const result = createExecutionDiagnostics(control, execution, [condition])
  expect(result.state).toBe('current')
  expect(result.checks.map((check) => [check.transition, check.status, check.reasons])).toEqual([
    ['event', 'event', []], ['condition', 'not-evaluated', []]
  ])

  execution.diagnostics = {
    state: execution.currentState, checkedAt: 1,
    checks: [{ transition: event._id, checkedAt: 1, status: 'waiting', reasons: [] }]
  }
  const next = createExecutionDiagnostics(control, execution, [condition])
  expect(next.checks[0]).toMatchObject({ checkedAt: 1, status: 'waiting' })
  expect(next.checks[1].status).toBe('not-evaluated')
})
