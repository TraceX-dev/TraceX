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

import core, {
  type Account,
  AccountRole,
  type AccountUuid,
  type Class,
  type Doc,
  type MeasureContext,
  MeasureMetricsContext,
  type Ref,
  type SessionData,
  toFindResult
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { QueryJoinMiddleware } from '../queryJoin'

const SPACE_CLASS = core.class.Space as Ref<Class<Doc>>

function sessionCtx (account: Partial<Account>, extra: Partial<SessionData> = {}): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as unknown as MeasureContext<SessionData>
  ;(ctx as any).contextData = { account, ...extra }
  return ctx
}

/**
 * With adapter security (Postgres) the query is not narrowed per account above the adapter: the adapter adds the
 * security filter from the context of the request. A joined query must not hand one account's result to another.
 */
describe('QueryJoinMiddleware security', () => {
  async function create (): Promise<{ join: QueryJoinMiddleware, calls: () => number }> {
    let calls = 0
    // Answers with the account that ran the query, like the security filter of the adapter would.
    const next = {
      findAll: async (ctx: MeasureContext<SessionData>) => {
        calls++
        await new Promise((resolve) => setTimeout(resolve, 50))
        const account = ctx.contextData.account
        const who = ctx.contextData.isTriggerCtx === true ? 'trigger' : `${account.uuid}:${account.role}`
        return toFindResult([{ _id: who } as unknown as Doc])
      }
    } as unknown as Middleware
    const join = await QueryJoinMiddleware.create(
      new MeasureMetricsContext('test', {}),
      {} as unknown as PipelineContext,
      next
    )
    return { join, calls: () => calls }
  }

  const userA = { uuid: 'acc-a' as AccountUuid, role: AccountRole.User }
  const userB = { uuid: 'acc-b' as AccountUuid, role: AccountRole.User }
  const guest = { uuid: 'acc-a' as AccountUuid, role: AccountRole.Guest }

  it('does not share a result between accounts', async () => {
    const { join } = await create()
    const [a, b] = await Promise.all([
      join.findAll(sessionCtx(userA), SPACE_CLASS, { _id: 'space-1' as Ref<Doc> }),
      join.findAll(sessionCtx(userB), SPACE_CLASS, { _id: 'space-1' as Ref<Doc> })
    ])
    expect(a.map((it) => it._id)).toEqual(['acc-a:USER'])
    expect(b.map((it) => it._id)).toEqual(['acc-b:USER'])
  })

  it('does not share a trigger result (no security filter) with a user', async () => {
    const { join } = await create()
    const [trigger, user] = await Promise.all([
      join.findAll(sessionCtx(userA, { isTriggerCtx: true }), SPACE_CLASS, { _id: 'space-1' as Ref<Doc> }),
      join.findAll(sessionCtx(userA), SPACE_CLASS, { _id: 'space-1' as Ref<Doc> })
    ])
    expect(trigger.map((it) => it._id)).toEqual(['trigger'])
    expect(user.map((it) => it._id)).toEqual(['acc-a:USER'])
  })

  it('does not share a result between roles of the same account', async () => {
    const { join } = await create()
    const [user, asGuest] = await Promise.all([
      join.findAll(sessionCtx(userA), SPACE_CLASS, {}),
      join.findAll(sessionCtx(guest), SPACE_CLASS, {})
    ])
    expect(user.map((it) => it._id)).toEqual(['acc-a:USER'])
    expect(asGuest.map((it) => it._id)).toEqual(['acc-a:GUEST'])
  })

  it('still joins the same query of the same account', async () => {
    const { join, calls } = await create()
    await Promise.all([
      join.findAll(sessionCtx(userA), SPACE_CLASS, {}),
      join.findAll(sessionCtx(userA), SPACE_CLASS, {})
    ])
    expect(calls()).toBe(1)
  })
})
