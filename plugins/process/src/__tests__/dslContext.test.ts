// Copyright © 2025 Hardcore Engineering Inc.
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

import { createDSLContext, parseDSLContext } from '../dslContext'
import type { Class, Doc, Ref } from '@hcengineering/core'
import type { ContextId } from '../index'
import type { SelectedUserRequest } from '../types'

describe('dslContext roundtrip', () => {
  test.each([
    { type: 'attribute', key: 'space' },
    { type: 'context', id: 'selected-card' as ContextId, key: 'space' },
    { type: 'context', id: 'selected-space' as ContextId, key: '' }
  ] as const)('user request preserves a space expression from $type', (source) => {
    const original: SelectedUserRequest = {
      type: 'userRequest',
      id: 'input' as ContextId,
      key: '',
      _class: 'test:class:Card' as Ref<Class<Doc>>,
      selectionSpace: createDSLContext(source)
    }

    const parsed = parseDSLContext(createDSLContext(original))
    expect(parsed).toEqual(expect.objectContaining(original))
    if (parsed?.type !== 'userRequest') throw new Error('Expected a user request')
    if (parsed.selectionSpace === undefined) throw new Error('Expected a selection space')
    expect(parseDSLContext(parsed.selectionSpace)).toEqual(expect.objectContaining(source))
  })

  test.each(['', 'owner'])('user request preserves selection space for key "%s"', (key) => {
    const original: SelectedUserRequest = {
      type: 'userRequest',
      id: 'input' as ContextId,
      key,
      _class: 'test:class:Card' as Ref<Class<Doc>>,
      selectionSpace: 'target-space'
    }

    expect(parseDSLContext(createDSLContext(original))).toEqual(expect.objectContaining(original))
  })

  test('user request without selection space keeps the existing DSL format', () => {
    // eslint-disable-next-line no-template-curly-in-string
    const dsl = '${$userRequest(input,,test:class:Card)}'
    const parsed = parseDSLContext(dsl)

    expect(parsed).toEqual(
      expect.objectContaining({ type: 'userRequest', id: 'input', key: '', _class: 'test:class:Card' })
    )
    expect(parsed).not.toHaveProperty('selectionSpace')
    if (parsed === undefined) throw new Error('Expected a parsed context')
    expect(createDSLContext(parsed)).toBe(dsl)
  })

  test('attribute', () => {
    const original = { type: 'attribute', key: 'name' } as any
    const dsl = createDSLContext(original)
    const parsed = parseDSLContext(dsl)
    expect(parsed).toEqual(expect.objectContaining({ type: 'attribute', key: 'name' }))
  })

  test('nested', () => {
    const original = { type: 'nested', path: 'owner', key: 'id' } as any
    const dsl = createDSLContext(original)
    const parsed = parseDSLContext(dsl)
    expect(parsed).toEqual(expect.objectContaining({ type: 'nested', path: 'owner', key: 'id' }))
  })

  test('const number and string', () => {
    const originalNum = { type: 'const', value: 42, key: 'answer' } as any
    const dslNum = createDSLContext(originalNum)
    const parsedNum = parseDSLContext(dslNum)
    expect(parsedNum).toEqual(expect.objectContaining({ type: 'const', key: 'answer', value: 42 }))

    const originalStr = { type: 'const', value: 'he"llo', key: 'greet' } as any
    const dslStr = createDSLContext(originalStr)
    const parsedStr = parseDSLContext(dslStr)
    expect(parsedStr).toEqual(expect.objectContaining({ type: 'const', key: 'greet', value: 'he"llo' }))
  })

  test('array const', () => {
    const original = { type: 'const', value: [1, 2, 3], key: 'arr' } as any
    const dsl = createDSLContext(original)
    const parsed = parseDSLContext(dsl)
    expect(parsed).toEqual(expect.objectContaining({ type: 'const', key: 'arr', value: [1, 2, 3] }))
  })

  test('function as primary', () => {
    const original = { type: 'function', func: 'myFunc' as any, props: { a: 1 }, key: '' } as any
    const dsl = createDSLContext(original)
    const parsed = parseDSLContext(dsl)
    expect((parsed as any).type).toBe('function')
    expect((parsed as any).func).toBeDefined()
  })

  test('modifiers SOURCE and FALLBACK and extra function', () => {
    const original = {
      type: 'attribute',
      key: 'x',
      sourceFunction: { func: 'src' as any, props: { p: 'v' } },
      functions: [{ func: 'f1' as any, props: {} }],
      fallbackValue: 10
    } as any
    const dsl = createDSLContext(original)
    const parsed = parseDSLContext(dsl)
    expect(parsed).toBeDefined()
    expect((parsed as any).sourceFunction).toBeDefined()
    expect((parsed as any).fallbackValue).toBe(10)
    expect((parsed as any).functions?.length).toBeGreaterThanOrEqual(1)
  })

  test('SOURCE preserves multiple properties', () => {
    const original = {
      type: 'attribute',
      key: 'items',
      sourceFunction: {
        func: 'FirstMatchValue' as any,
        props: {
          status: { $in: [null] },
          _class: 'test:class:Item',
          $sort: { rank: 1 }
        }
      }
    } as any

    const parsed = parseDSLContext(createDSLContext(original))

    expect((parsed as any).sourceFunction?.props).toEqual(original.sourceFunction.props)
  })

  test('nested template with arrow inside should not split modifiers', () => {
    // eslint-disable-next-line no-template-curly-in-string
    const dsl = '${@x=>MYFUNC(${@inner=>OTHER()})=>FALLBACK(1)}'
    const parsed = parseDSLContext(dsl)
    expect(parsed).toBeDefined()
    expect((parsed as any).type).toBe('attribute')
    expect((parsed as any).key).toBe('x')
    expect((parsed as any).functions?.length).toBeGreaterThanOrEqual(1)
    expect((parsed as any).fallbackValue).toBe(1)
  })
})
