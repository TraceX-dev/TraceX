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

import { getNextProductVersionNumber, type ProductVersionNumber } from '../product-version'

function v (major: number, minor: number, patch: number): ProductVersionNumber {
  return { major, minor, patch }
}

describe('getNextProductVersionNumber', () => {
  it.each([null, undefined])('returns 1.0.0 when there is no parent (%p)', (parent) => {
    expect(getNextProductVersionNumber(parent, 'patch')).toEqual(v(1, 0, 0))
    expect(getNextProductVersionNumber(parent, 'minor')).toEqual(v(1, 0, 0))
    expect(getNextProductVersionNumber(parent, 'major')).toEqual(v(1, 0, 0))
  })

  describe('patch', () => {
    it.each([
      [v(1, 0, 0), v(1, 0, 1)],
      [v(1, 1, 0), v(1, 1, 1)],
      [v(1, 6, 0), v(1, 6, 1)],
      [v(1, 6, 2), v(1, 6, 3)],
      [v(2, 3, 9), v(2, 3, 10)]
    ])('%p -> %p', (parent, expected) => {
      expect(getNextProductVersionNumber(parent, 'patch')).toEqual(expected)
    })

    it('keeps the parent minor version', () => {
      expect(getNextProductVersionNumber(v(1, 1, 0), 'patch').minor).toBe(1)
    })
  })

  describe('minor', () => {
    it.each([
      [v(1, 0, 0), v(1, 1, 0)],
      [v(1, 1, 0), v(1, 2, 0)],
      [v(1, 6, 3), v(1, 7, 0)],
      [v(2, 9, 1), v(2, 10, 0)]
    ])('%p -> %p', (parent, expected) => {
      expect(getNextProductVersionNumber(parent, 'minor')).toEqual(expected)
    })
  })

  describe('major', () => {
    it.each([
      [v(1, 0, 0), v(2, 0, 0)],
      [v(1, 6, 3), v(2, 0, 0)],
      [v(9, 1, 1), v(10, 0, 0)]
    ])('%p -> %p', (parent, expected) => {
      expect(getNextProductVersionNumber(parent, 'major')).toEqual(expected)
    })
  })

  it('does not mutate the parent', () => {
    const parent = v(1, 1, 0)
    getNextProductVersionNumber(parent, 'patch')
    expect(parent).toEqual(v(1, 1, 0))
  })
})
