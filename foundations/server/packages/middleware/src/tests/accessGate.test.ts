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

function makeUpdateTx (): TxCUD<Doc> {
  const factory = new TxFactory('test:account:System' as PersonId)
  return factory.createTxUpdateDoc(SOME_CLASS, 'test:space:Some' as any, generateId(), {} as any) as TxCUD<Doc>
}

describe('hasClassAccessLevel', () => {
  it('grants the declared minimum role and roles above it', async () => {
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

    const ownerAllowed = await hasClassAccessLevel(
      hierarchy,
      undefined,
      makeCtx(),
      makeCreateTx(),
      makeAccount(AccountRole.Owner)
    )
    expect(ownerAllowed).toBe(true)

    const denied = await hasClassAccessLevel(
      hierarchy,
      undefined,
      makeCtx(),
      makeCreateTx(),
      makeAccount(AccountRole.Guest)
    )
    expect(denied).toBe(false)
  })

  it.each([AccountRole.ReadOnlyGuest, AccountRole.DocGuest, AccountRole.Guest])(
    'allows restricted role %s when ReadOnlyGuest is the declared minimum',
    async (role) => {
      const hierarchy = new Hierarchy()
      hierarchy.classHierarchyMixin = ((_class: any) =>
        _class === SOME_CLASS ? { createAccessLevel: AccountRole.ReadOnlyGuest } : undefined) as any

      const allowed = await hasClassAccessLevel(hierarchy, undefined, makeCtx(), makeCreateTx(), makeAccount(role))
      expect(allowed).toBe(true)
    }
  )

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

  it('a ClassPermission with an explicit txClass only covers that tx kind (regression test for the txClass generalization)', async () => {
    const hierarchy = new Hierarchy()
    hierarchy.isDerived = ((a: any, b: any) => a === b) as any
    hierarchy.classHierarchyMixin = (() => undefined) as any

    const next: Middleware = {
      findAll: (async (_ctx: any, _class: any) => {
        if (_class === core.class.ModulePermissionGroup) {
          return [{ role: AccountRole.Guest, permissions: ['p1'], enabled: true }] as any
        }
        if (_class === core.class.ClassPermission) {
          return [{ _id: 'p1', targetClass: SOME_CLASS, txClass: core.class.TxUpdateDoc }] as any
        }
        return []
      }) as any
    } as any

    const classAccess = new ClassAccessResolver(next)

    const updateAllowed = await isClassAccessAllowed(
      hierarchy,
      next,
      classAccess,
      makeCtx(),
      makeUpdateTx(),
      makeAccount(AccountRole.Guest)
    )
    expect(updateAllowed).toBe(true)

    const createAllowed = await isClassAccessAllowed(
      hierarchy,
      next,
      classAccess,
      makeCtx(),
      makeCreateTx(),
      makeAccount(AccountRole.Guest)
    )
    expect(createAllowed).toBe(false)
  })
})
