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
 * `RowVisibilityResolver.canUpdate` ("Ensures an update or mixin extension cannot transfer a row
 * to another owner") used to only run for `TxUpdateDoc`, silently allowing any `TxMixin` through -
 * even though Layer 1 (`hasClassAccessLevel` in `../accessGate`) already grants `TxMixin` the same
 * access as `TxUpdateDoc`. These are regression tests for closing that gap.
 *
 * `TxProcessor.updateMixin4Doc` only ever writes to `doc[tx.mixin]`, never to a base-class field
 * like the `user`/`attachedTo` fields real `ownerField` policies protect, so an end-to-end
 * `SpaceSecurityMiddleware` scenario can't actually demonstrate a blocked transfer via `TxMixin`.
 * These tests instead exercise `canUpdate` directly, proving the guard judges the fetched document
 * itself rather than defaulting to "allowed" whenever the tx happens to be a `TxMixin`.
 */

import {
  AccountRole,
  generateId,
  MeasureMetricsContext,
  TxFactory,
  type Account,
  type Class,
  type Doc,
  type Hierarchy,
  type MeasureContext,
  type PersonId,
  type Ref,
  type RowVisibility,
  type SessionData,
  type Space
} from '@hcengineering/core'
import { AccountIdentityResolver, RowVisibilityResolver } from '../rowVisibility'

const TEST_CLASS = 'test:class:OwnedDoc' as Ref<Class<Doc>>
const TEST_MIXIN = 'test:mixin:Extra' as Ref<Class<Doc>>
const TEST_SPACE = 'test:space:Workspace' as Ref<Space>

function makeAccount (uuid: string): Account {
  return {
    uuid: uuid as any,
    role: AccountRole.Guest,
    primarySocialId: 'test' as PersonId,
    socialIds: ['test' as PersonId],
    fullSocialIds: []
  }
}

function makeHierarchy (): Hierarchy {
  return {
    classHierarchyMixin: (_class: Ref<Class<Doc>>): Partial<RowVisibility> | undefined => {
      if (_class !== TEST_CLASS) return undefined
      return {
        policy: { kind: 'ownerField', field: 'user', identity: 'accountUuid' },
        allowKnownIdBypass: false
      }
    }
  } as any
}

describe('RowVisibilityResolver.canUpdate - TxMixin parity with TxUpdateDoc', () => {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  const OWNER = 'owner-account'
  const OTHER = 'other-account'

  it('TxUpdateDoc: denies an operation that reassigns the owner field to someone else', async () => {
    const resolver = new RowVisibilityResolver(undefined)
    const identity = new AccountIdentityResolver(undefined, ctx, makeAccount(OWNER))
    const doc = { _id: generateId(), _class: TEST_CLASS, space: TEST_SPACE, user: OWNER } as any
    const factory = new TxFactory('test' as PersonId)
    const tx = factory.createTxUpdateDoc(TEST_CLASS, TEST_SPACE, doc._id, { user: OTHER } as any)

    const allowed = await resolver.canUpdate(makeHierarchy(), TEST_CLASS, doc, tx, identity)
    expect(allowed).toBe(false)
  })

  it('TxUpdateDoc: allows an operation that leaves the owner field untouched', async () => {
    const resolver = new RowVisibilityResolver(undefined)
    const identity = new AccountIdentityResolver(undefined, ctx, makeAccount(OWNER))
    const doc = { _id: generateId(), _class: TEST_CLASS, space: TEST_SPACE, user: OWNER } as any
    const factory = new TxFactory('test' as PersonId)
    const tx = factory.createTxUpdateDoc(TEST_CLASS, TEST_SPACE, doc._id, { note: 'x' } as any)

    const allowed = await resolver.canUpdate(makeHierarchy(), TEST_CLASS, doc, tx, identity)
    expect(allowed).toBe(true)
  })

  it('TxMixin: denies when the fetched document does not belong to the caller (regression test for the Layer 1/Layer 2 parity fix)', async () => {
    const resolver = new RowVisibilityResolver(undefined)
    const identity = new AccountIdentityResolver(undefined, ctx, makeAccount(OWNER))
    const doc = { _id: generateId(), _class: TEST_CLASS, space: TEST_SPACE, user: OTHER } as any
    const factory = new TxFactory('test' as PersonId)
    const tx = factory.createTxMixin(doc._id, TEST_CLASS, TEST_SPACE, TEST_MIXIN, { note: 'x' } as any)

    const allowed = await resolver.canUpdate(makeHierarchy(), TEST_CLASS, doc, tx, identity)
    expect(allowed).toBe(false)
  })

  it('TxMixin: allows extending a document the caller owns', async () => {
    const resolver = new RowVisibilityResolver(undefined)
    const identity = new AccountIdentityResolver(undefined, ctx, makeAccount(OWNER))
    const doc = { _id: generateId(), _class: TEST_CLASS, space: TEST_SPACE, user: OWNER } as any
    const factory = new TxFactory('test' as PersonId)
    const tx = factory.createTxMixin(doc._id, TEST_CLASS, TEST_SPACE, TEST_MIXIN, { note: 'x' } as any)

    const allowed = await resolver.canUpdate(makeHierarchy(), TEST_CLASS, doc, tx, identity)
    expect(allowed).toBe(true)
  })
})
