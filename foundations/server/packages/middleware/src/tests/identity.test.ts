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
  AccountRole,
  MeasureMetricsContext,
  SocialIdType,
  TxFactory,
  type Account,
  type AccountUuid,
  type MeasureContext,
  type PersonId,
  type SessionData
} from '@hcengineering/core'
import type { PipelineContext } from '@hcengineering/server-core'
import { IdentityMiddleware } from '../identity'

const uuid = '00000000-0000-4000-8000-000000000001' as AccountUuid
const human = 'human-author' as PersonId
const external = 'external-author' as PersonId

async function fixture (
  socialId: PersonId
): Promise<{ middleware: IdentityMiddleware, ctx: MeasureContext<SessionData> }> {
  const account: Account = {
    uuid,
    role: AccountRole.User,
    primarySocialId: human,
    socialId,
    socialIds: [human, external],
    fullSocialIds: [
      { _id: human, type: SocialIdType.HULY, value: uuid, key: `huly:${uuid}` },
      { _id: external, type: SocialIdType.EXTERNAL, value: `${uuid}:codex`, key: `external:${uuid}:codex` }
    ]
  }
  const data: Partial<SessionData> = {
    account,
    socialStringsToUsers: new Map([
      [human, { accontUuid: uuid, role: AccountRole.User }],
      [external, { accontUuid: uuid, role: AccountRole.User }]
    ])
  }
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = data as SessionData
  const pipeline: Partial<PipelineContext> = {}
  return { middleware: await IdentityMiddleware.create(ctx, pipeline as PipelineContext, undefined), ctx }
}

it('accepts the acting external author while the primary identity stays personal', async () => {
  const { middleware, ctx } = await fixture(external)
  const tx = new TxFactory(external).createTxCreateDoc(core.class.Doc, core.space.Workspace, {})
  await expect(middleware.tx(ctx, [tx])).resolves.toEqual({})
  expect(ctx.contextData.account.primarySocialId).toBe(human)
})

it.each([
  [external, human],
  [human, external]
])('rejects changing the author from %s to %s', async (socialId, author) => {
  const { middleware, ctx } = await fixture(socialId)
  const tx = new TxFactory(author).createTxCreateDoc(core.class.Doc, core.space.Workspace, {})
  expect(() => middleware.tx(ctx, [tx])).toThrow()
})

it('checks the acting author of transactions inside ApplyIf', async () => {
  const { middleware, ctx } = await fixture(external)
  const tx = new TxFactory(human).createTxCreateDoc(core.class.Doc, core.space.Workspace, {})
  const batch = new TxFactory(external).createTxApplyIf(core.space.Workspace, undefined, [], [], [tx], undefined)
  expect(() => middleware.tx(ctx, [batch])).toThrow()
})
