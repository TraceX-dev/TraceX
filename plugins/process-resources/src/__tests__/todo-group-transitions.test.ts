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

import type { Client, Ref } from '@hcengineering/core'
import type { Execution, ProcessToDo } from '@hcengineering/process'
import { todoTranstionCheck } from '../utils'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({ showPopup: jest.fn() }))
jest.mock('@hcengineering/text-core', () => ({ isEmptyMarkup: jest.fn() }))

const executionData: Partial<Execution> = { _id: 'execution' as Ref<Execution> }
const execution = executionData as Execution
const current: Partial<ProcessToDo> = {
  _id: 'second' as Ref<ProcessToDo>,
  group: 'group',
  completionMode: 'all',
  doneOn: null
}

describe('group to-do transition checks', () => {
  it.each([null, 1])('waits for other participants with completion time %s', async (doneOn) => {
    const client = {
      findAll: jest.fn(async () => [current, { _id: 'first', doneOn }])
    } as unknown as Client
    expect(
      await todoTranstionCheck(
        client,
        execution,
        {
          _id: 'group',
          result: { stale: 'answer' }
        },
        { todo: current }
      )
    ).toBe(doneOn !== null)
  })

  it('keeps result conditions for any-mode groups', async () => {
    const client: Partial<Client> = {}
    const context = { todo: { ...current, completionMode: 'any' }, answer: 'yes' }
    expect(
      await todoTranstionCheck(
        client as Client,
        execution,
        {
          _id: 'group',
          result: { answer: 'yes' }
        },
        context
      )
    ).toBe(true)
    expect(
      await todoTranstionCheck(
        client as Client,
        execution,
        {
          _id: 'group',
          result: { answer: 'no' }
        },
        context
      )
    ).toBe(false)
  })

  it('does not match a completion from another group', async () => {
    const client: Partial<Client> = {}
    expect(
      await todoTranstionCheck(
        client as Client,
        execution,
        {
          _id: 'another-group'
        },
        { todo: current }
      )
    ).toBe(false)
  })
})
