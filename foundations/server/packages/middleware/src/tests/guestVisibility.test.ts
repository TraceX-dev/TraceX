//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

/**
 * `excludeSpacesFromQuery` used to dereference `current.$in` without the null-guard its siblings
 * `mergeEquals`/`mergeIn` (`../rowVisibility`) have, so a query narrowing a space field to `null`
 * (e.g. `{ space: null }`) crashed instead of being treated as a plain scalar value. Regression
 * tests for that fix.
 */

import type { Ref, Space } from '@hcengineering/core'
import { excludeSpacesFromQuery } from '../guestVisibility'

const SPACE_A = 'test:space:A' as Ref<Space>
const SPACE_B = 'test:space:B' as Ref<Space>
const SPACE_C = 'test:space:C' as Ref<Space>

describe('excludeSpacesFromQuery', () => {
  it('does not throw for a null field constraint and leaves it unchanged (regression test for the null-guard fix)', () => {
    const result = excludeSpacesFromQuery(null as any, new Set([SPACE_A]))
    expect(result).toEqual({ query: null })
  })

  it('passes through unchanged when there is nothing to exclude', () => {
    const result = excludeSpacesFromQuery(undefined, new Set())
    expect(result).toEqual({ query: undefined })
  })

  it('turns an undefined constraint into $nin', () => {
    const result = excludeSpacesFromQuery(undefined, new Set([SPACE_A]))
    expect(result).toEqual({ query: { $nin: [SPACE_A] } })
  })

  it('denies a bare ref that is excluded', () => {
    const result = excludeSpacesFromQuery(SPACE_A, new Set([SPACE_A]))
    expect(result).toEqual({ deny: true })
  })

  it('leaves a bare ref that is not excluded unchanged', () => {
    const result = excludeSpacesFromQuery(SPACE_B, new Set([SPACE_A]))
    expect(result).toEqual({ query: SPACE_B })
  })

  it('filters an existing $in, denying once nothing is left', () => {
    const narrowed = excludeSpacesFromQuery({ $in: [SPACE_A, SPACE_B] }, new Set([SPACE_A]))
    expect(narrowed).toEqual({ query: { $in: [SPACE_B] } })

    const emptied = excludeSpacesFromQuery({ $in: [SPACE_A] }, new Set([SPACE_A]))
    expect(emptied).toEqual({ deny: true })
  })

  it('merges into an existing $nin', () => {
    const result = excludeSpacesFromQuery({ $nin: [SPACE_C] }, new Set([SPACE_A]))
    expect(result).toEqual({ query: { $nin: [SPACE_C, SPACE_A] } })
  })
})
