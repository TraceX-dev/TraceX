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
  type AccountUuid,
  type Class,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type Hierarchy,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxApplyIf,
  type TxCreateDoc,
  type TxCUD,
  type TxUpdateDoc,
  type TxWorkspaceEvent,
  TxProcessor,
  WorkspaceEvent
} from '@hcengineering/core'
import contact, { type Person } from '@hcengineering/contact'
import { isDerivedSafe } from './guestPersonUtils'

/**
 * Raw find used by the cache. Must bypass guest person filtering.
 */
export type VisibilityFindAll = <T extends Doc>(
  ctx: MeasureContext<SessionData>,
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>,
  options?: FindOptions<T>
) => Promise<T[]>

type SpaceMembership = Pick<Space, '_id' | '_class' | 'members' | 'owners' | 'archived'>

export interface VisibleSet {
  /** Account/person uuids the guest is allowed to list. Always contains the guest itself. */
  readonly accounts: ReadonlySet<string>
  /** Person refs for `accounts`, used to filter attached contact docs (SocialIdentity, Channel). */
  readonly personRefs: ReadonlySet<Ref<Person>>
}

/**
 * Spaces every workspace user implicitly belongs to. They never widen guest visibility.
 */
const MAIN_SPACES = new Set<Ref<Space>>([
  core.space.Configuration,
  core.space.DerivedTx,
  core.space.Model,
  core.space.Space,
  core.space.Workspace,
  core.space.Tx
])

const MEMBERSHIP_KEYS = ['members', 'owners', 'archived'] as const

/**
 * Per-workspace cache of persons visible to guest accounts.
 *
 * Visible accounts = the guest itself ∪ members/owners of non-system, non-archived spaces the guest is a member of.
 * Loaded lazily per guest (one space query + one person query) and dropped entirely on any membership or
 * person <-> account binding change. Invalidation is driven by committed txes only.
 */
export class GuestVisibilityCache {
  private readonly visibleByAccount = new Map<AccountUuid, Promise<VisibleSet>>()
  private generation = 0

  constructor (
    private readonly hierarchy: Pick<Hierarchy, 'isDerived'>,
    private readonly findAll: VisibilityFindAll
  ) {}

  /**
   * Returns the cached visibility set or loads it; concurrent calls share one load.
   *
   * A load invalidated while in flight still answers its callers (as if they came just before the change),
   * but is not kept in cache.
   */
  getVisible (ctx: MeasureContext<SessionData>, account: AccountUuid): Promise<VisibleSet> {
    const cached = this.visibleByAccount.get(account)
    if (cached !== undefined) return cached

    const generation = this.generation
    const load = this.loadVisible(ctx, account)
    this.visibleByAccount.set(account, load)
    const forget = (): void => {
      if (this.visibleByAccount.get(account) === load) this.visibleByAccount.delete(account)
    }
    load.then(() => {
      if (generation !== this.generation) forget()
    }, forget)
    return load
  }

  /**
   * Drops cached data if the transaction may change guest visibility.
   */
  handleTx (tx: Tx): void {
    if (tx._class === core.class.TxApplyIf) {
      for (const it of (tx as TxApplyIf).txes) this.handleTx(it)
      return
    }
    if (tx._class === core.class.TxWorkspaceEvent) {
      if ((tx as TxWorkspaceEvent).event === WorkspaceEvent.BulkUpdate) this.invalidate()
      return
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return
    const cud = tx as TxCUD<Doc>
    if (isDerivedSafe(this.hierarchy, cud.objectClass, core.class.Space)) {
      if (isMembershipChange(cud)) this.invalidate()
      return
    }
    if (isDerivedSafe(this.hierarchy, cud.objectClass, contact.class.Person) && isPersonIdentityChange(cud)) {
      // Person refs depend on person <-> account binding.
      this.invalidate()
    }
  }

  invalidate (): void {
    this.generation++
    this.visibleByAccount.clear()
  }

  private async loadVisible (ctx: MeasureContext<SessionData>, account: AccountUuid): Promise<VisibleSet> {
    return await ctx.with('guest-person-visible', {}, async (ctx) => {
      const spaces = (await this.findAll(
        ctx,
        core.class.Space,
        { members: account },
        { projection: { _id: 1, _class: 1, members: 1, owners: 1, archived: 1 } }
      )) as SpaceMembership[]

      const accounts = new Set<string>([account])
      for (const space of spaces) {
        if (space.archived) continue
        if (MAIN_SPACES.has(space._id)) continue
        if (isDerivedSafe(this.hierarchy, space._class, core.class.SystemSpace)) continue
        for (const member of space.members ?? []) accounts.add(member)
        for (const owner of space.owners ?? []) accounts.add(owner)
      }

      const persons = await this.findAll(
        ctx,
        contact.class.Person,
        { personUuid: { $in: Array.from(accounts) as Array<Person['personUuid']> } },
        { projection: { _id: 1 } }
      )
      return { accounts, personRefs: new Set(persons.map((it) => it._id)) }
    })
  }
}

function isMembershipChange (tx: TxCUD<Doc>): boolean {
  if (tx._class === core.class.TxCreateDoc || tx._class === core.class.TxRemoveDoc) return true
  if (tx._class !== core.class.TxUpdateDoc) return false
  const ops = (tx as TxUpdateDoc<Space>).operations as Record<string, unknown>
  if (MEMBERSHIP_KEYS.some((key) => ops[key] !== undefined || hasOwn(ops.$unset, key))) return true
  return ['members', 'owners'].some((key) => hasOwn(ops.$push, key) || hasOwn(ops.$pull, key))
}

function isPersonIdentityChange (tx: TxCUD<Doc>): boolean {
  if (tx._class === core.class.TxCreateDoc) {
    return (tx as TxCreateDoc<Person>).attributes.personUuid !== undefined
  }
  if (tx._class === core.class.TxRemoveDoc) return true
  if (tx._class === core.class.TxUpdateDoc) {
    const operations = (tx as TxUpdateDoc<Person>).operations
    return operations.personUuid !== undefined || hasOwn(operations.$unset, 'personUuid')
  }
  return false
}

function hasOwn (value: unknown, key: string): boolean {
  return value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
}
