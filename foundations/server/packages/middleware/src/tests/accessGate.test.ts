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
 * Unit tests for `accessGate.ts` in isolation from `GuestPermissionsMiddleware` - in particular,
 * that `hasClassAccessLevel`/`isClassAccessAllowed` compare against the calling account's own
 * role rather than a hardcoded `AccountRole.Guest`. Today only `Guest` ever reaches this code
 * (see `guestPermissions.test.ts` for that black-box behavior), but the resolver itself is
 * generic - this proves it, so a future caller for another role doesn't need to touch this file.
 */

import core, {
  AccountRole,
  generateId,
  Hierarchy,
  MeasureMetricsContext,
  TxFactory,
  type Account,
  type Class,
  type Doc,
  type MeasureContext,
  type PersonId,
  type Ref,
  type TxCUD
} from '@hcengineering/core'
import type { Middleware } from '@hcengineering/server-core'
import { ClassAccessResolver, hasClassAccessLevel, isClassAccessAllowed } from '../accessGate'

const SOME_CLASS = 'test:class:Some' as Ref<Class<Doc>>

function makeAccount (role: AccountRole): Account {
  return {
    uuid: generateId() as any,
    role,
    primarySocialId: 'test' as PersonId,
    socialIds: ['test' as PersonId],
    fullSocialIds: []
  }
}

function makeCtx (): MeasureContext {
  return new MeasureMetricsContext('test', {})
}

function makeCreateTx (): TxCUD<Doc> {
  const factory = new TxFactory('test:account:System' as PersonId)
  return factory.createTxCreateDoc(SOME_CLASS, 'test:space:Some' as any, {}) as TxCUD<Doc>
}

describe('hasClassAccessLevel', () => {
  it('grants a role matching TxAccessLevel.createAccessLevel, whatever that role is', async () => {
    const hierarchy = new Hierarchy()
    hierarchy.classHierarchyMixin = ((_class: any) =>
      _class === SOME_CLASS ? { createAccessLevel: AccountRole.Maintainer } : undefined) as any

    const allowed = await hasClassAccessLevel(
      hierarchy,
      undefined,
      makeCtx(),
      makeCreateTx(),
      makeAccount(AccountRole.Maintainer)
    )
    expect(allowed).toBe(true)

    const denied = await hasClassAccessLevel(
      hierarchy,
      undefined,
      makeCtx(),
      makeCreateTx(),
      makeAccount(AccountRole.Guest)
    )
    expect(denied).toBe(false)
  })

  it('denies when no TxAccessLevel mixin is declared for the class', async () => {
    const hierarchy = new Hierarchy()
    hierarchy.classHierarchyMixin = (() => undefined) as any
    const allowed = await hasClassAccessLevel(
      hierarchy,
      undefined,
      makeCtx(),
      makeCreateTx(),
      makeAccount(AccountRole.Guest)
    )
    expect(allowed).toBe(false)
  })
})

describe('isClassAccessAllowed', () => {
  it('always allows User and above, regardless of policy', async () => {
    const hierarchy = new Hierarchy()
    hierarchy.classHierarchyMixin = (() => undefined) as any
    const classAccess = new ClassAccessResolver(undefined)
    const allowed = await isClassAccessAllowed(
      hierarchy,
      undefined,
      classAccess,
      makeCtx(),
      makeCreateTx(),
      makeAccount(AccountRole.User)
    )
    expect(allowed).toBe(true)
  })

  it('allows a create covered by ModulePermissionGroup for the caller role', async () => {
    const hierarchy = new Hierarchy()
    hierarchy.isDerived = ((a: any, b: any) => a === b) as any
    hierarchy.classHierarchyMixin = (() => undefined) as any

    const next: Middleware = {
      findAll: (async (_ctx: any, _class: any) => {
        if (_class === core.class.ModulePermissionGroup) {
          return [{ role: AccountRole.Guest, permissions: ['p1'], enabled: true }] as any
        }
        if (_class === core.class.ClassPermission) {
          return [{ _id: 'p1', targetClass: SOME_CLASS }] as any
        }
        return []
      }) as any
    } as any

    const classAccess = new ClassAccessResolver(next)
    const allowed = await isClassAccessAllowed(
      hierarchy,
      next,
      classAccess,
      makeCtx(),
      makeCreateTx(),
      makeAccount(AccountRole.Guest)
    )
    expect(allowed).toBe(true)
  })
})
