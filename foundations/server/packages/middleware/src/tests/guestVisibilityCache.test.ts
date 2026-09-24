/**

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
*/

import core, {
  MeasureMetricsContext,
  type AccountUuid,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  TxFactory,
  WorkspaceEvent
} from '@hcengineering/core'
import contact, { type Person } from '@hcengineering/contact'
import { GuestVisibilityCache, isDerivedSafe } from '../guestVisibilityCache'

const PARENTS: Record<string, string | undefined> = {
  [core.class.Doc]: undefined,
  [core.class.Space]: core.class.Doc,
  [core.class.SystemSpace]: core.class.Space,
  [contact.class.Contact]: core.class.Doc,
  [contact.class.Person]: contact.class.Contact
}

const hierarchy = {
  isDerived: (_class: string, base: string): boolean => {
    let current: string | undefined = _class
    while (current !== undefined) {
      if (current === base) return true
      if (!(current in PARENTS)) throw new Error(`Unknown class ${current}`)
      current = PARENTS[current]
    }
    return false
  }
}

const GUEST = 'guest-uuid' as AccountUuid
const MEMBER = 'member-uuid' as AccountUuid
const OWNER = 'owner-uuid' as AccountUuid
const SYSTEM_MEMBER = 'system-member-uuid' as AccountUuid
const ARCHIVED_MEMBER = 'archived-member-uuid' as AccountUuid
const LONER = 'loner-uuid' as AccountUuid

const SPACES = [
  { _id: 'space:project', _class: core.class.Space, members: [GUEST, MEMBER], owners: [OWNER] },
  { _id: 'space:system', _class: core.class.SystemSpace, members: [GUEST, SYSTEM_MEMBER] },
  { _id: core.space.Workspace, _class: core.class.Space, members: [GUEST, SYSTEM_MEMBER] },
  { _id: 'space:archived', _class: core.class.Space, members: [GUEST, ARCHIVED_MEMBER], archived: true }
]

const PERSONS = [
  { _id: 'person:guest', personUuid: GUEST },
  { _id: 'person:member', personUuid: MEMBER },
  { _id: 'person:owner', personUuid: OWNER },
  { _id: 'person:system', personUuid: SYSTEM_MEMBER }
]

function makeCtx (): MeasureContext<SessionData> {
  return new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
}

function makeCache (): { cache: GuestVisibilityCache, calls: string[] } {
  const calls: string[] = []
  const findAll = async (_ctx: MeasureContext, _class: string, query: Record<string, any>): Promise<any[]> => {
    calls.push(_class)
    if (_class === core.class.Space) return SPACES.filter((it) => it.members.includes(query.members))
    if (_class === contact.class.Person) return PERSONS.filter((it) => query.personUuid.$in.includes(it.personUuid))
    return []
  }
  return { cache: new GuestVisibilityCache(hierarchy, findAll), calls }
}

const factory = new TxFactory('test' as PersonId)
const spaceUpdate = (ops: Record<string, any>): any =>
  factory.createTxUpdateDoc(core.class.Space, core.space.Space, 'space:project' as Ref<Space>, ops)
const spaceLoads = (calls: string[]): number => calls.filter((it) => it === core.class.Space).length

describe('GuestVisibilityCache', () => {
  it('collects members and owners, ignoring system, main and archived spaces', async () => {
    const { cache } = makeCache()
    const accounts = await cache.getVisibleAccounts(makeCtx(), GUEST)
    expect(accounts).toEqual(new Set([GUEST, MEMBER, OWNER]))
  })

  it('contains only the account itself when it has no spaces', async () => {
    const { cache } = makeCache()
    expect(await cache.getVisibleAccounts(makeCtx(), LONER)).toEqual(new Set([LONER]))
  })

  it('resolves person refs of visible accounts', async () => {
    const { cache } = makeCache()
    const refs = await cache.getVisiblePersonRefs(makeCtx(), GUEST)
    expect(refs).toEqual(new Set(['person:guest', 'person:member', 'person:owner']))
  })

  it('deduplicates concurrent loads', async () => {
    const { cache, calls } = makeCache()
    const ctx = makeCtx()
    await Promise.all([cache.getVisibleAccounts(ctx, GUEST), cache.getVisibleAccounts(ctx, GUEST)])
    expect(spaceLoads(calls)).toBe(1)
  })

  it.each([
    ['$push members', { $push: { members: LONER } }],
    ['$pull members', { $pull: { members: MEMBER } }],
    ['members', { members: [GUEST] }],
    ['owners', { owners: [] }],
    ['archived', { archived: true }]
  ])('reloads after space %s change', async (_name, ops) => {
    const { cache, calls } = makeCache()
    const ctx = makeCtx()
    await cache.getVisibleAccounts(ctx, GUEST)
    cache.handleTx(spaceUpdate(ops))
    await cache.getVisibleAccounts(ctx, GUEST)
    expect(spaceLoads(calls)).toBe(2)
  })

  it('reloads after space create, bulk update and nested apply', async () => {
    const { cache, calls } = makeCache()
    const ctx = makeCtx()
    const load = async (): Promise<void> => {
      await cache.getVisibleAccounts(ctx, GUEST)
    }

    await load()
    cache.handleTx(factory.createTxCreateDoc(core.class.Space, core.space.Space, {} as any))
    await load()
    cache.handleTx({
      _class: core.class.TxWorkspaceEvent,
      event: WorkspaceEvent.BulkUpdate
    } as any)
    await load()
    cache.handleTx(factory.createTxApplyIf(core.space.Tx, 'scope', [], [], [spaceUpdate({ $push: { members: LONER } })], undefined))
    await load()
    expect(spaceLoads(calls)).toBe(4)
  })

  it('keeps cache on unrelated changes', async () => {
    const { cache, calls } = makeCache()
    const ctx = makeCtx()
    await cache.getVisibleAccounts(ctx, GUEST)
    cache.handleTx(spaceUpdate({ name: 'renamed' }))
    cache.handleTx(
      factory.createTxUpdateDoc(contact.class.Person, core.space.Workspace, 'person:member' as Ref<Person>, {
        name: 'x'
      })
    )
    await cache.getVisibleAccounts(ctx, GUEST)
    expect(spaceLoads(calls)).toBe(1)
  })

  it('drops person refs when a person is bound to an account', async () => {
    const { cache, calls } = makeCache()
    const ctx = makeCtx()
    await cache.getVisiblePersonRefs(ctx, GUEST)
    cache.handleTx(
      factory.createTxCreateDoc(contact.class.Person, core.space.Workspace, { personUuid: LONER } as any)
    )
    await cache.getVisiblePersonRefs(ctx, GUEST)
    expect(calls.filter((it) => it === contact.class.Person)).toHaveLength(2)
  })

  it('does not cache failed loads', async () => {
    let fail = true
    const findAll = async (): Promise<any[]> => {
      if (fail) throw new Error('db down')
      return []
    }
    const cache = new GuestVisibilityCache(hierarchy, findAll)
    await expect(cache.getVisibleAccounts(makeCtx(), GUEST)).rejects.toThrow('db down')
    fail = false
    expect(await cache.getVisibleAccounts(makeCtx(), GUEST)).toEqual(new Set([GUEST]))
  })

  it('isDerivedSafe treats unknown classes as unrelated', () => {
    expect(isDerivedSafe(hierarchy, 'unknown:class' as any, core.class.Space)).toBe(false)
    expect(isDerivedSafe(hierarchy, undefined, core.class.Space)).toBe(false)
    expect(isDerivedSafe(hierarchy, core.class.SystemSpace, core.class.Space)).toBe(true)
  })
})
