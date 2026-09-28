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
  type Class,
  type Doc,
  generateId,
  type MeasureContext,
  MeasureMetricsContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  TxFactory
} from '@hcengineering/core'
import type { PipelineContext } from '@hcengineering/server-core'
import { GuestPermissionsMiddleware } from '../guestPermissions'

const DOC_CLASS = 'test:class:Doc' as Ref<Class<Doc>>
const SPACE = 'test:space:Space' as Ref<Space>

describe('GuestPermissionsMiddleware rejection log', () => {
  it('logs attribute names of a rejected update, never values', async () => {
    const context = {
      hierarchy: { isDerived: (a: unknown, b: unknown) => a === b, classHierarchyMixin: () => undefined }
    } as unknown as PipelineContext
    const mw = new (GuestPermissionsMiddleware as any)(context, { tx: async () => ({}) }) as GuestPermissionsMiddleware
    ;(mw as any).findAll = async () => []

    const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
    ctx.contextData = {
      account: {
        uuid: generateId(),
        role: AccountRole.Guest,
        primarySocialId: 'test:guest',
        socialIds: ['test:guest'],
        fullSocialIds: []
      },
      broadcast: { txes: [], queue: [], sessions: {} }
    } as any
    const warn = jest.spyOn(ctx, 'warn')

    const tx = new TxFactory('test:guest' as PersonId).createTxUpdateDoc(DOC_CLASS, SPACE, generateId(), {
      title: 'secret title',
      $push: { members: 'secret member' },
      $inc: { counter: 1 }
    } as any)
    await expect(mw.tx(ctx, [tx])).rejects.toThrow()

    expect(warn).toHaveBeenCalledWith('Guest transaction rejected', {
      reason: 'document-access-not-granted',
      accountRole: AccountRole.Guest,
      txClass: core.class.TxUpdateDoc,
      objectClass: DOC_CLASS,
      objectSpace: SPACE,
      operations: ['title', '$push.members', '$inc.counter']
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret')
  })
})
