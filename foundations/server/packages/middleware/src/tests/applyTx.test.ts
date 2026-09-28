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

import {
  type Class,
  type Doc,
  MeasureMetricsContext,
  type PersonId,
  type Ref,
  type Space,
  type Tx,
  type TxApplyIf,
  TxFactory
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { ApplyTxMiddleware } from '../applyTx'

const SPACE = 'test:space:Space' as Ref<Space>
const CHECKED_CLASS = 'test:class:Checked' as Ref<Class<Doc>>
const OTHER_CLASS = 'test:class:Other' as Ref<Class<Doc>>

interface TestNext {
  middleware: Middleware
  provided: Tx[][]
}

function makeNext (findAll: () => Promise<Doc[]>): TestNext {
  const provided: Tx[][] = []
  const middleware = {
    tx: async (_ctx: unknown, txes: Tx[]) => {
      provided.push(txes)
      return {}
    },
    findAll
  } as unknown as Middleware
  return { middleware, provided }
}

async function makeMiddleware (next: Middleware): Promise<ApplyTxMiddleware> {
  const context = {
    hierarchy: { isDerived: (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) => a === b }
  } as unknown as PipelineContext
  return (await ApplyTxMiddleware.create(new MeasureMetricsContext('test', {}), context, next)) as ApplyTxMiddleware
}

function makeApply (scope: string, notMatchClass: Ref<Class<Doc>> = CHECKED_CLASS): TxApplyIf {
  const factory = new TxFactory('test:account' as PersonId)
  return factory.createTxApplyIf(
    SPACE,
    scope,
    [],
    [{ _class: notMatchClass, query: {} }],
    [factory.createTxCreateDoc(OTHER_CLASS, SPACE, {})],
    'test'
  )
}

describe('ApplyTxMiddleware', () => {
  it('releases the scope when a check throws', async () => {
    let fail = true
    const next = makeNext(async () => {
      if (fail) throw new Error('find failed')
      return []
    })
    const mw = await makeMiddleware(next.middleware)
    const ctx = new MeasureMetricsContext('test', {})

    await expect(mw.tx(ctx, [makeApply('scope')])).rejects.toThrow('find failed')
    expect(mw.scopes.size).toBe(0)

    fail = false
    await mw.tx(ctx, [makeApply('scope')])
    expect(next.provided).toHaveLength(1)
  })

  it('runs applies of one scope one at a time', async () => {
    let active = 0
    let maxActive = 0
    const next = makeNext(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return []
    })
    const mw = await makeMiddleware(next.middleware)
    const ctx = new MeasureMetricsContext('test', {})

    await Promise.all([1, 2, 3].map(async () => await mw.tx(ctx, [makeApply('scope')])))

    expect(maxActive).toBe(1)
    expect(next.provided).toHaveLength(3)
    expect(mw.scopes.size).toBe(0)
  })

  it('passes on plain txes that precede an apply', async () => {
    const next = makeNext(async () => [])
    const mw = await makeMiddleware(next.middleware)
    const factory = new TxFactory('test:account' as PersonId)
    const plain = factory.createTxCreateDoc(OTHER_CLASS, SPACE, {})

    await mw.tx(new MeasureMetricsContext('test', {}), [plain, makeApply('scope')])

    expect(next.provided[0]).toEqual([plain])
    expect(next.provided).toHaveLength(2)
  })

  it('does not lock applies without a scope', async () => {
    const next = makeNext(async () => [])
    const mw = await makeMiddleware(next.middleware)
    const factory = new TxFactory('test:account' as PersonId)
    const apply = factory.createTxApplyIf(SPACE, undefined, [], [], [], 'test')

    await mw.tx(new MeasureMetricsContext('test', {}), [apply])
    expect(mw.scopes.size).toBe(0)
  })
})
