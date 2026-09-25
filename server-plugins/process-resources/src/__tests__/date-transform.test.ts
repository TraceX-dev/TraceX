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

import { createContext } from '@hcengineering/process'
import type { ContextId, Execution } from '@hcengineering/process'
import type { ProcessControl } from '@hcengineering/server-process'
import { DateFromNumber, NumberFromDate, Offset } from '../transform'

const contextId = 'offset' as ContextId
const control = {
  client: { getModel: () => ({ findObject: () => undefined }) }
} as unknown as ProcessControl

function executionWithOffset (offset: unknown): Execution {
  return { context: { [contextId]: offset } } as unknown as Execution
}

const contextOffset = createContext({ type: 'context', id: contextId, key: '' })
const date = new Date(2026, 0, 15, 12).getTime()

describe('process date transformations', () => {
  it.each([0, -86400000, date])('round-trips a date through a number: %p', (timestamp) => {
    expect(DateFromNumber(NumberFromDate(timestamp))).toBe(timestamp)
  })

  it.each([
    ['days', 'after', 2, new Date(2026, 0, 17, 12).getTime()],
    ['weeks', 'before', 2, new Date(2026, 0, 1, 12).getTime()],
    ['months', 'after', 2, new Date(2026, 2, 15, 12).getTime()],
    ['days', 'after', 0, date],
    ['days', 'after', -2, new Date(2026, 0, 13, 12).getTime()]
  ])('applies %s %s with offset %p from a literal or context', async (offsetType, direction, offset, expected) => {
    for (const source of [offset, contextOffset]) {
      await expect(
        Offset(date, { offset: source, offsetType, direction }, control, executionWithOffset(offset))
      ).resolves.toBe(expected)
    }
  })

  it.each(['invalid', null, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores a nonnumeric context offset: %p',
    async (offset) => {
      await expect(
        Offset(
          date,
          { offset: contextOffset, offsetType: 'days', direction: 'after' },
          control,
          executionWithOffset(offset)
        )
      ).resolves.toBe(date)
    }
  )

  it('can offset a converted number', async () => {
    await expect(
      Offset(
        DateFromNumber(date),
        { offset: contextOffset, offsetType: 'days', direction: 'after' },
        control,
        executionWithOffset(2)
      )
    ).resolves.toBe(new Date(2026, 0, 17, 12).getTime())
  })
})
