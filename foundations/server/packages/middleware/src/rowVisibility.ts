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

/** Lazily resolves the identities used by row-visibility policies. */
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

  /** Public-link identity from the session token. */
  linkId (): Ref<Doc> | undefined {
    return this.ctx.contextData.extra?.linkId as Ref<Doc> | undefined
  }

  /** All social identities linked to the account. */
  async resolve (kind: IdentityKind): Promise<string | string[] | undefined> {
    switch (kind) {
      case 'accountUuid':
        return this.account.uuid
      case 'personId':
        return await this.personId()
      case 'socialId':
        return this.account.socialIds.length === 1 ? this.account.socialIds[0] : this.account.socialIds
      case 'linkId':
        return this.linkId()
    }
  }
}

/** Matches a field against either a single identity or a set of social identities. */
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

/** Intersects a query field constraint with a required value. */
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

/** Narrows a query field to a set of allowed values. */
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
    if (typeof hierarchy.classHierarchyMixin !== 'function') {
      return { kind: 'unrestricted' }
    }
    const mixin = hierarchy.classHierarchyMixin(_class as Ref<Class<Doc>>, core.mixin.RowVisibility)
    if (mixin === undefined) {
      return { kind: 'unrestricted' }
    }

    if (
      allowKnownIdBypass &&
      mixin.allowKnownIdBypass === true &&
      mixin.knownIdBypassReason !== undefined &&
      mixin.knownIdBypassReason.trim() !== ''
    ) {
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
      case 'spaceScoped':
        return true
      case 'linkedViaRecord':
      case 'denyAll':
        return false
    }
  }

  /** Ensures an update or mixin extension cannot transfer a row to another owner. */
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

  /** Resolves the targets accessible through a `linkedViaRecord` policy. */
  private async resolveLinkedTargets (
    ctx: MeasureContext<SessionData>,
    policy: Extract<RowVisibilityPolicy, { kind: 'linkedViaRecord' }>,
    identity: AccountIdentityResolver
  ): Promise<Set<Ref<Doc>> | undefined> {
    const value = await identity.resolve(policy.identity)
    if (value === undefined || (Array.isArray(value) && value.length === 0)) return undefined
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
      case 'spaceMember':
      case 'spaceScoped':
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
