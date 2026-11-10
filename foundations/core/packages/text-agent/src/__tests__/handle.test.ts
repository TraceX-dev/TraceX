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

import { decodeHandle, encodeHandle, InvalidHandleError } from '../index'
import type { Handle } from '../index'

describe('handle serialization', () => {
  it('uses a predictable client.clock base36 representation', () => {
    const handle: Handle = { client: 42, clock: 36 }
    expect(encodeHandle(handle)).toBe('16.10')
    expect(decodeHandle('16.10')).toEqual(handle)
  })

  it('supports zero values and maximum safe integer values', () => {
    const zero: Handle = { client: 0, clock: 0 }
    const maximum: Handle = { client: Number.MAX_SAFE_INTEGER, clock: Number.MAX_SAFE_INTEGER }
    expect(encodeHandle(zero)).toBe('0.0')
    expect(decodeHandle('0.0')).toEqual(zero)
    expect(decodeHandle(encodeHandle(maximum))).toEqual(maximum)
  })

  it.each(['', '1', '1.', '.1', '1.2.3', '-1.0', '0.-1', '+1.0', 'A.0', ' 1.0', '1.0 ', '1/0'])(
    'rejects malformed strings: %j',
    (value) => {
      expect(() => decodeHandle(value)).toThrow(InvalidHandleError)
    }
  )

  it('accepts base36 components with leading zeroes', () => {
    expect(decodeHandle('016.00')).toEqual({ client: 42, clock: 0 })
  })
})
