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
 * Row-level ownership resolution (Layer 2, see `core.mixin.RowVisibility` / `RowVisibilityPolicy`)
 * for classes not scoped by ordinary space-based filtering.
 *
 * Deliberately role-agnostic: nothing here compares `account.role`. Which accounts this runs for
 * is entirely up to the call site (`isRowLevelRestricted(account.role)` in `spaceSecurity.ts`).
 */
import core, {
  type Account,
  type Class,
  type Doc,
  type DocumentQuery,
  type Hierarchy,
  type IdentityKind,
  type MeasureContext,
  type Ref,
  type RowVisibilityPolicy,
  type SessionData,
  type TxMixin,
  type TxUpdateDoc,
  TxProcessor
} from '@hcengineering/core'
import type { Middleware } from '@hcengineering/server-core'
import contact, { type Person } from '@hcengineering/contact'
import { hasNarrowFieldQuery } from './guestVisibility'

/** Resolves an account to the identity values `RowVisibilityPolicy` comparisons need. Lazy -
 * most policies only need one of the three, and `personId` costs a DB round trip. */
export class AccountIdentityResolver {
  private personIdPromise: Promise<Ref<Person> | undefined> | undefined

  constructor (
    private readonly next: Middleware | undefined,
    private readonly ctx: MeasureContext<SessionData>,
    private readonly account: Account
  ) {}

  /** The caller's own `contact.class.Person` ref, if any. */
  async personId (): Promise<Ref<Person> | undefined> {
    if (this.personIdPromise === undefined) {
      this.personIdPromise = (async () => {
        const personQuery: DocumentQuery<Person> = { personUuid: this.account.uuid }
        const persons = ((await this.next?.findAll(this.ctx, contact.class.Person, personQuery, {
          projection: { _id: 1 },
          limit: 1
        })) ?? []) as Array<Pick<Person, '_id'>>
        return persons[0]?._id
      })()
    }
    return await this.personIdPromise
  }

  /** `linkId` claim from the session token (`SessionData.extra`). Every public-link guest shares
   * the same fixed account, so this - not the account - identifies whose session it is. */
  linkId (): Ref<Doc> | undefined {
    return this.ctx.contextData.extra?.linkId as Ref<Doc> | undefined
  }

  /** `socialId` resolves to every social id linked to the account (a guest's own docs may be
   * authored under any of them, not just the current primary) - callers must match against all. */
  async resolve (kind: IdentityKind): Promise<string | string[] | undefined> {
    switch (kind) {
      case 'accountUuid':
        return this.account.uuid
      case 'personId':
        return await this.personId()
      case 'socialId':
        // Collapse to a scalar in the (overwhelmingly common) single-social-id case, so query
        // shapes and comparisons are unchanged unless the account actually has more than one.
        return this.account.socialIds.length === 1 ? this.account.socialIds[0] : this.account.socialIds
      case 'linkId':
        return this.linkId()
    }
  }
}

/** Whether `resolved` (from `AccountIdentityResolver.resolve`) matches `fieldValue`, handling the
 * `socialId` case's multi-value result uniformly with the single-value identity kinds. */
function identityMatches (fieldValue: unknown, resolved: string | string[] | undefined): boolean {
  if (Array.isArray(resolved)) return resolved.length > 0 && resolved.includes(fieldValue as string)
  return resolved !== undefined && fieldValue === resolved
}

export type RowVisibilityDecision<T extends Doc> =
  | { kind: 'unrestricted' }
  | { kind: 'narrow', query: DocumentQuery<T> }
  | { kind: 'deny' }

interface MutationAwareVisibility {
  policy: RowVisibilityPolicy
  writePolicy?: RowVisibilityPolicy
}

function getWritePolicy (mixin: MutationAwareVisibility): RowVisibilityPolicy {
  return mixin.writePolicy ?? mixin.policy
}

/** Intersects an existing query field constraint with a required value; denies (`undefined`) on
 * conflict. Mirrors what `hasNarrowFieldQuery` considers "narrow" - anything else is overwritten. */
function mergeEquals<T extends Doc> (query: DocumentQuery<T>, field: string, value: any): DocumentQuery<T> | undefined {
  const current = (query as Record<string, any>)[field]
  if (current === undefined) {
    return { ...query, [field]: value }
  }
  if (typeof current === 'object' && current !== null && Array.isArray(current.$in)) {
    return (current.$in as any[]).includes(value) ? { ...query, [field]: value } : undefined
  }
  if (typeof current !== 'object') {
    return current === value ? query : undefined
  }
  return { ...query, [field]: value }
}

/** Same as `mergeEquals`, but narrows to a set of allowed values (`$in`). */
function mergeIn<T extends Doc> (
  query: DocumentQuery<T>,
  field: string,
  values: Set<any>
): DocumentQuery<T> | undefined {
  const current = (query as Record<string, any>)[field]
  if (current === undefined) {
    return { ...query, [field]: { $in: Array.from(values) } }
  }
  if (typeof current === 'object' && current !== null && Array.isArray(current.$in)) {
    const filtered = (current.$in as any[]).filter((v) => values.has(v))
    return filtered.length === 0 ? undefined : { ...query, [field]: { $in: filtered } }
  }
  if (typeof current !== 'object') {
    return values.has(current) ? query : undefined
  }
  return { ...query, [field]: { $in: Array.from(values) } }
}

/** Applies `core.mixin.RowVisibility` (if declared) to a `findAll` query. */
export class RowVisibilityResolver {
  constructor (private readonly next: Middleware | undefined) {}

  hasPolicy (hierarchy: Hierarchy, _class: Ref<Class<Doc>>): boolean {
    // Some focused middleware tests use a minimal hierarchy double that only implements the
    // methods exercised by the scenario. A real Hierarchy always provides this method.
    if (typeof hierarchy.classHierarchyMixin !== 'function') return false
    return hierarchy.classHierarchyMixin(_class, core.mixin.RowVisibility) !== undefined
  }

  async resolve<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    hierarchy: Hierarchy,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    identity: AccountIdentityResolver,
    allowKnownIdBypass = true
  ): Promise<RowVisibilityDecision<T>> {
    // Cast to a concrete `Ref<Class<Doc>>`: with the caller's own `_class: Ref<Class<T>>` passed
    // through as-is, `classHierarchyMixin`'s `M extends D` constraint unifies `M` with `T` instead
    // of `RowVisibility`, and `mixin` below loses its fields to `T`.
    if (typeof hierarchy.classHierarchyMixin !== 'function') {
      return { kind: 'unrestricted' }
    }
    const mixin = hierarchy.classHierarchyMixin(_class as Ref<Class<Doc>>, core.mixin.RowVisibility)
    if (mixin === undefined) {
      return { kind: 'unrestricted' }
    }

    if (allowKnownIdBypass && mixin.allowKnownIdBypass) {
      const bypassFields = ['_id', ...(mixin.knownIdBypassFields ?? [])]
      if (bypassFields.some((field) => hasNarrowFieldQuery(query, field))) {
        return { kind: 'unrestricted' }
      }
    }

    return await this.applyPolicy(ctx, mixin.policy, query, identity)
  }

  /** Resolves the policy used for update/remove without allowing known-reference bypasses. */
  async resolveMutation<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    hierarchy: Hierarchy,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    identity: AccountIdentityResolver
  ): Promise<RowVisibilityDecision<T>> {
    if (typeof hierarchy.classHierarchyMixin !== 'function') return { kind: 'unrestricted' }
    const mixin = hierarchy.classHierarchyMixin(_class as Ref<Class<Doc>>, core.mixin.RowVisibility)
    if (mixin === undefined) return { kind: 'unrestricted' }
    return await this.applyPolicy(ctx, getWritePolicy(mixin), query, identity)
  }

  /** Validates ownership fields on a document before it exists in storage. */
  async canCreate (
    ctx: MeasureContext<SessionData>,
    hierarchy: Hierarchy,
    _class: Ref<Class<Doc>>,
    doc: Doc,
    identity: AccountIdentityResolver
  ): Promise<boolean> {
    if (typeof hierarchy.classHierarchyMixin !== 'function') return true
    const mixin = hierarchy.classHierarchyMixin(_class, core.mixin.RowVisibility)
    if (mixin?.policy === undefined) return true
    const policy = getWritePolicy(mixin)

    switch (policy.kind) {
      case 'ownerField': {
        const value = await identity.resolve(policy.identity)
        return identityMatches((doc as unknown as Record<string, unknown>)[policy.field], value)
      }
      case 'spaceMember':
      case 'publicReadable':
        return true
      case 'linkedViaRecord':
      case 'denyAll':
        return false
    }
  }

  /** Ensures an update or mixin extension cannot transfer a row to another owner. Covers both tx
   * kinds `hasClassAccessLevel` (Layer 1, `./accessGate`) already treats as equivalent mutations,
   * and both policy kinds capable of expressing ownership (`ownerField` directly, `linkedViaRecord`
   * via its `targetField`) - a class combining write access with any other policy kind has no
   * mutable ownership field for this guard to check, so it's left to Layer 1 access level alone. */
  async canUpdate (
    ctx: MeasureContext<SessionData>,
    hierarchy: Hierarchy,
    _class: Ref<Class<Doc>>,
    doc: Doc,
    tx: TxUpdateDoc<Doc> | TxMixin<Doc, Doc>,
    identity: AccountIdentityResolver
  ): Promise<boolean> {
    if (typeof hierarchy.classHierarchyMixin !== 'function') return true
    const mixin = hierarchy.classHierarchyMixin(_class, core.mixin.RowVisibility)
    if (mixin === undefined) return true
    const policy = getWritePolicy(mixin)
    if (policy.kind !== 'ownerField' && policy.kind !== 'linkedViaRecord') return true

    const updated =
      tx._class === core.class.TxMixin
        ? TxProcessor.updateMixin4Doc({ ...doc }, tx as TxMixin<Doc, Doc>)
        : TxProcessor.updateDoc2Doc({ ...doc }, tx as TxUpdateDoc<Doc>)
    const updatedFields = updated as unknown as Record<string, unknown>

    if (policy.kind === 'ownerField') {
      const value = await identity.resolve(policy.identity)
      return identityMatches(updatedFields[policy.field], value)
    }

    const allowed = await this.resolveLinkedTargets(ctx, policy, identity)
    if (allowed === undefined) return false
    return allowed.has(updatedFields[policy.targetField ?? '_id'] as Ref<Doc>)
  }

  /** Resolves a `linkedViaRecord` policy to its set of allowed target ids (`undefined` means deny),
   * shared between `applyPolicy`'s read-side narrowing and `canUpdate`'s ownership-transfer guard. */
  private async resolveLinkedTargets (
    ctx: MeasureContext<SessionData>,
    policy: Extract<RowVisibilityPolicy, { kind: 'linkedViaRecord' }>,
    identity: AccountIdentityResolver
  ): Promise<Set<Ref<Doc>> | undefined> {
    const value = await identity.resolve(policy.identity)
    if (value === undefined || (Array.isArray(value) && value.length === 0)) return undefined
    // `DocumentQuery<Doc>`'s catch-all `[key: string]: any` accepts the computed key directly.
    const linkQuery: DocumentQuery<Doc> = {
      [policy.linkIdentityField]: Array.isArray(value) ? { $in: value } : value
    }
    const projection: Record<string, 1> = { [policy.linkTargetField]: 1 }
    const links = ((await this.next?.findAll(ctx, policy.linkClass, linkQuery, { projection })) ?? []) as Array<
    Record<string, Ref<Doc>>
    >
    const linkedTargets = new Set<Ref<Doc>>(links.map((l) => l[policy.linkTargetField]))
    if (linkedTargets.size === 0) return undefined
    let allowed = linkedTargets
    const through = policy.through
    if (through !== undefined) {
      const throughQuery: DocumentQuery<Doc> = {
        [through.sourceField]: { $in: Array.from(linkedTargets) }
      }
      const throughProjection: Record<string, 1> = { [through.targetField]: 1 }
      const throughDocs = ((await this.next?.findAll(ctx, through.documentClass, throughQuery, {
        projection: throughProjection
      })) ?? []) as Array<Record<string, Ref<Doc>>>
      allowed = new Set<Ref<Doc>>(throughDocs.map((doc) => doc[through.targetField]))
      if (through.includeDirect === true) {
        for (const target of linkedTargets) allowed.add(target)
      }
    }
    return allowed
  }

  private async applyPolicy<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    policy: RowVisibilityPolicy,
    query: DocumentQuery<T>,
    identity: AccountIdentityResolver
  ): Promise<RowVisibilityDecision<T>> {
    switch (policy.kind) {
      // no-ops: spaceMember is handled elsewhere in the pipeline, publicReadable means "don't restrict"
      case 'spaceMember':
      case 'publicReadable':
        return { kind: 'unrestricted' }

      case 'denyAll':
        return { kind: 'deny' }

      case 'ownerField': {
        const value = await identity.resolve(policy.identity)
        if (value === undefined || (Array.isArray(value) && value.length === 0)) return { kind: 'deny' }
        const merged = Array.isArray(value)
          ? mergeIn(query, policy.field, new Set(value))
          : mergeEquals(query, policy.field, value)
        return merged === undefined ? { kind: 'deny' } : { kind: 'narrow', query: merged }
      }

      case 'linkedViaRecord': {
        const allowed = await this.resolveLinkedTargets(ctx, policy, identity)
        if (allowed === undefined) return { kind: 'deny' }
        const merged = mergeIn(query, policy.targetField ?? '_id', allowed)
        return merged === undefined ? { kind: 'deny' } : { kind: 'narrow', query: merged }
      }
    }
  }
}
