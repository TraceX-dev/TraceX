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
import type { Middleware } from '@hcengineering/server-core'
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

    const allowed = await resolver.canUpdate(ctx, makeHierarchy(), TEST_CLASS, doc, tx, identity)
    expect(allowed).toBe(false)
  })

  it('TxUpdateDoc: allows an operation that leaves the owner field untouched', async () => {
    const resolver = new RowVisibilityResolver(undefined)
    const identity = new AccountIdentityResolver(undefined, ctx, makeAccount(OWNER))
    const doc = { _id: generateId(), _class: TEST_CLASS, space: TEST_SPACE, user: OWNER } as any
    const factory = new TxFactory('test' as PersonId)
    const tx = factory.createTxUpdateDoc(TEST_CLASS, TEST_SPACE, doc._id, { note: 'x' } as any)

    const allowed = await resolver.canUpdate(ctx, makeHierarchy(), TEST_CLASS, doc, tx, identity)
    expect(allowed).toBe(true)
  })

  it('TxMixin: denies when the fetched document does not belong to the caller (regression test for the Layer 1/Layer 2 parity fix)', async () => {
    const resolver = new RowVisibilityResolver(undefined)
    const identity = new AccountIdentityResolver(undefined, ctx, makeAccount(OWNER))
    const doc = { _id: generateId(), _class: TEST_CLASS, space: TEST_SPACE, user: OTHER } as any
    const factory = new TxFactory('test' as PersonId)
    const tx = factory.createTxMixin(doc._id, TEST_CLASS, TEST_SPACE, TEST_MIXIN, { note: 'x' } as any)

    const allowed = await resolver.canUpdate(ctx, makeHierarchy(), TEST_CLASS, doc, tx, identity)
    expect(allowed).toBe(false)
  })

  it('TxMixin: allows extending a document the caller owns', async () => {
    const resolver = new RowVisibilityResolver(undefined)
    const identity = new AccountIdentityResolver(undefined, ctx, makeAccount(OWNER))
    const doc = { _id: generateId(), _class: TEST_CLASS, space: TEST_SPACE, user: OWNER } as any
    const factory = new TxFactory('test' as PersonId)
    const tx = factory.createTxMixin(doc._id, TEST_CLASS, TEST_SPACE, TEST_MIXIN, { note: 'x' } as any)

    const allowed = await resolver.canUpdate(ctx, makeHierarchy(), TEST_CLASS, doc, tx, identity)
    expect(allowed).toBe(true)
  })
})

describe('AccountIdentityResolver - socialId matches any linked social id, not only primary', () => {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  const SOCIAL_CLASS = 'test:class:SocialOwnedDoc' as Ref<Class<Doc>>
  const PRIMARY = 'primary-social' as PersonId
  const SECONDARY = 'secondary-social' as PersonId

  function makeMultiSocialAccount (): Account {
    return {
      uuid: 'multi-social-account' as any,
      role: AccountRole.Guest,
      primarySocialId: PRIMARY,
      socialIds: [PRIMARY, SECONDARY],
      fullSocialIds: []
    }
  }

  function makeSocialHierarchy (): Hierarchy {
    return {
      classHierarchyMixin: (_class: Ref<Class<Doc>>): Partial<RowVisibility> | undefined => {
        if (_class !== SOCIAL_CLASS) return undefined
        return {
          policy: { kind: 'ownerField', field: 'createdBy', identity: 'socialId' },
          allowKnownIdBypass: false
        }
      }
    } as any
  }

  it('read narrowing matches a document created under a non-primary social id', async () => {
    const resolver = new RowVisibilityResolver(undefined)
    const identity = new AccountIdentityResolver(undefined, ctx, makeMultiSocialAccount())
    const decision = await resolver.resolve(ctx, makeSocialHierarchy(), SOCIAL_CLASS, {}, identity)
    expect(decision).toEqual({ kind: 'narrow', query: { createdBy: { $in: [PRIMARY, SECONDARY] } } })
  })

  it('canUpdate allows editing a document created under a non-primary social id', async () => {
    const resolver = new RowVisibilityResolver(undefined)
    const identity = new AccountIdentityResolver(undefined, ctx, makeMultiSocialAccount())
    const doc = { _id: generateId(), _class: SOCIAL_CLASS, space: TEST_SPACE, createdBy: SECONDARY } as any
    const factory = new TxFactory(SECONDARY)
    const tx = factory.createTxUpdateDoc(SOCIAL_CLASS, TEST_SPACE, doc._id, { note: 'x' } as any)

    const allowed = await resolver.canUpdate(ctx, makeSocialHierarchy(), SOCIAL_CLASS, doc, tx, identity)
    expect(allowed).toBe(true)
  })

  it('canCreate allows authoring a document under a non-primary social id', async () => {
    const resolver = new RowVisibilityResolver(undefined)
    const identity = new AccountIdentityResolver(undefined, ctx, makeMultiSocialAccount())
    const doc = { _id: generateId(), _class: SOCIAL_CLASS, space: TEST_SPACE, createdBy: SECONDARY } as any

    const allowed = await resolver.canCreate(ctx, makeSocialHierarchy(), SOCIAL_CLASS, doc, identity)
    expect(allowed).toBe(true)
  })
})

describe('RowVisibilityResolver.canUpdate - linkedViaRecord ownership-transfer guard', () => {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  const LINKED_CLASS = 'test:class:LinkedDoc' as Ref<Class<Doc>>
  const LINK_CLASS = 'test:class:Link' as Ref<Class<Doc>>
  const CALLER = 'caller-account'
  const ALLOWED_ROOM = 'allowed-room' as Ref<Doc>
  const OTHER_ROOM = 'other-room' as Ref<Doc>

  function makeAccount (): Account {
    return {
      uuid: CALLER as any,
      role: AccountRole.Guest,
      primarySocialId: 'test' as PersonId,
      socialIds: ['test' as PersonId],
      fullSocialIds: []
    }
  }

  function makeNext (): Middleware {
    return {
      findAll: (async (_ctx: any, _class: any, query: any) => {
        if (_class === LINK_CLASS && query.collaborator === CALLER) {
          return [{ _id: generateId(), collaborator: CALLER, attachedTo: ALLOWED_ROOM }] as any
        }
        return []
      }) as any
    } as any
  }

  function makeLinkedHierarchy (): Hierarchy {
    return {
      classHierarchyMixin: (_class: Ref<Class<Doc>>): Partial<RowVisibility> | undefined => {
        if (_class !== LINKED_CLASS) return undefined
        return {
          policy: {
            kind: 'linkedViaRecord',
            linkClass: LINK_CLASS,
            linkTargetField: 'attachedTo',
            linkIdentityField: 'collaborator',
            identity: 'accountUuid',
            targetField: 'room'
          },
          allowKnownIdBypass: false
        }
      }
    } as any
  }

  it('denies moving the document to a target the caller has no link to (regression test for the linkedViaRecord ownership-transfer gap)', async () => {
    const next = makeNext()
    const resolver = new RowVisibilityResolver(next)
    const identity = new AccountIdentityResolver(next, ctx, makeAccount())
    const doc = { _id: generateId(), _class: LINKED_CLASS, space: TEST_SPACE, room: ALLOWED_ROOM } as any
    const factory = new TxFactory('test' as PersonId)
    const tx = factory.createTxUpdateDoc(LINKED_CLASS, TEST_SPACE, doc._id, { room: OTHER_ROOM } as any)

    const allowed = await resolver.canUpdate(ctx, makeLinkedHierarchy(), LINKED_CLASS, doc, tx, identity)
    expect(allowed).toBe(false)
  })

  it('allows an update that leaves the linked target untouched', async () => {
    const next = makeNext()
    const resolver = new RowVisibilityResolver(next)
    const identity = new AccountIdentityResolver(next, ctx, makeAccount())
    const doc = { _id: generateId(), _class: LINKED_CLASS, space: TEST_SPACE, room: ALLOWED_ROOM } as any
    const factory = new TxFactory('test' as PersonId)
    const tx = factory.createTxUpdateDoc(LINKED_CLASS, TEST_SPACE, doc._id, { note: 'x' } as any)

    const allowed = await resolver.canUpdate(ctx, makeLinkedHierarchy(), LINKED_CLASS, doc, tx, identity)
    expect(allowed).toBe(true)
  })
})
