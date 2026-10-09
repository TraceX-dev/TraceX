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

import { runInNewContext } from 'node:vm'
import { extractValues } from '../indexer/extract-values'

describe('extractValues', () => {
  it.each([
    { name: 'scalar', input: 'alpha', expected: 'alpha ' },
    { name: 'array', input: ['alpha', 'beta'], expected: 'alpha beta ' },
    { name: 'object', input: { first: 'alpha', second: 'beta' }, expected: 'alpha beta ' },
    {
      name: 'nested objects and arrays',
      input: { items: ['alpha', { label: 'beta' }], details: { count: 0, enabled: false } },
      expected: 'alpha 0 false beta '
    },
    { name: 'null', input: null, expected: '' },
    { name: 'undefined', input: undefined, expected: '' },
    { name: 'empty array', input: [], expected: '' },
    { name: 'empty object', input: {}, expected: '' },
    { name: 'empty nested values', input: [null, undefined, [], {}, 'alpha', 0, false], expected: 'alpha 0 false ' }
  ])('extracts $name without hanging', ({ input, expected }) => {
    // Jest timeouts cannot interrupt a synchronous infinite loop.
    const result = runInNewContext('extractValues(input)', { extractValues, input }, { timeout: 1000 })

    expect(result).toBe(expected)
  })
})
