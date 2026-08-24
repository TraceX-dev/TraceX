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

import { findProperty, type Doc } from '@hcengineering/core'
import { buildResult, Modes, parseValue } from '../query'

describe('criteria query modes', () => {
  describe('buildResult', () => {
    test('builds scalar queries', () => {
      expect(buildResult(Modes.Equal, 'value')).toBe('value')
      expect(buildResult(Modes.NotEqual, 'value')).toEqual({ $ne: 'value' })
      expect(buildResult(Modes.StringContains, 'value')).toEqual({ $like: '%value%' })
      expect(buildResult(Modes.GT, 10)).toEqual({ $gt: 10 })
      expect(buildResult(Modes.LT, 10)).toEqual({ $lt: 10 })
      expect(buildResult(Modes.Between, [10, 20])).toEqual({ $gte: 10, $lte: 20 })
    })

    test('builds array queries', () => {
      const value = ['first', 'second']

      expect(buildResult(Modes.ArrayAll, value)).toEqual({ $all: value })
      expect(buildResult(Modes.ArrayAny, value)).toEqual({ $in: value })
      expect(buildResult(Modes.ArrayNotIncludes, value)).toEqual({ $nin: value })
    })

    test('builds array size queries', () => {
      expect(buildResult(Modes.ArraySizeEquals, 2)).toEqual({ $size: 2 })
      expect(buildResult(Modes.ArraySizeGt, 2)).toEqual({ $size: { $gt: 2 } })
      expect(buildResult(Modes.ArraySizeGte, 2)).toEqual({ $size: { $gte: 2 } })
      expect(buildResult(Modes.ArraySizeLt, 2)).toEqual({ $size: { $lt: 2 } })
      expect(buildResult(Modes.ArraySizeLte, 2)).toEqual({ $size: { $lte: 2 } })
    })

    test('builds editorless queries without using the editor value', () => {
      expect(buildResult(Modes.Exists, undefined)).toEqual({ $exists: true })
      expect(buildResult(Modes.ValueIsNotSet, undefined)).toEqual({ $in: [null] })
    })

    test('does not mutate mode query templates', () => {
      buildResult(Modes.Between, [10, 20])
      buildResult(Modes.ValueIsNotSet, undefined)

      expect(Modes.Between.query).toEqual({ $gte: '$val[0]', $lte: '$val[1]' })
      expect(Modes.ValueIsNotSet.query).toEqual({ $in: [null] })
    })
  })

  describe('ValueIsNotSet', () => {
    test('matches null and undefined values', () => {
      const docs = [
        { _id: 'null', value: null },
        { _id: 'undefined', value: undefined },
        { _id: 'missing' },
        { _id: 'set', value: 'value' }
      ] as unknown as Doc[]

      const result = findProperty(docs, 'value', buildResult(Modes.ValueIsNotSet, undefined))

      expect(result.map(({ _id }) => _id)).toEqual(['null', 'undefined', 'missing'])
    })

    test('is parsed without intercepting ArrayAny queries', () => {
      const modes = Object.values(Modes)

      expect(parseValue(modes, { $in: [null] })[1]).toBe(Modes.ValueIsNotSet)
      expect(parseValue(modes, { $in: [null, undefined] })[1]).toBe(Modes.ValueIsNotSet)
      expect(parseValue(modes, { $in: ['value'] })[1]).toBe(Modes.ArrayAny)
    })
  })
})
