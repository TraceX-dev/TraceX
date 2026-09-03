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
  type RelationPath,
  type NamedConstraint,
  type TraversalStep,
  MAX_TRAVERSAL_DEPTH,
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
  /**
   * The policy depends on the row itself (a document-relative step) and cannot be pushed into a
   * query. The caller fetches the candidate and asks `matchesDocument`. Read paths treat this as
   * a denial: narrowing a browse query per row is not something the storage layer can do.
   */
  | { kind: 'perDocument' }
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

/**
 * Upper bound on the size of a traversal's intermediate value set. Reaching it denies access
 * rather than widening it: a policy that cannot be evaluated exactly must not resolve to "allow".
 */
export const MAX_TRAVERSAL_VALUES = 10000

/**
 * Turns a `NamedConstraint` into a query fragment. Returning `undefined` denies the traversal,
 * so an unknown or unsatisfiable constraint fails closed.
 */
export type NamedConstraintResolver = (
  constraint: NamedConstraint,
  _class: Ref<Class<Doc>>
) => DocumentQuery<Doc> | undefined

const defaultConstraintResolver: NamedConstraintResolver = (constraint) => {
  switch (constraint) {
    case 'notArchived':
      return { archived: false } as unknown as DocumentQuery<Doc>
    case 'ordinarySpacesOnly':
      // Requires the middleware's view of non-ordinary spaces; without it the traversal is denied.
      return undefined
  }
}

/**
 * Caches resolved traversal steps. Keyed by the step signature plus the incoming value set, so a
 * step shared by several policies is read once. Invalidated per `via` class when a transaction
 * touches it.
 */
export class TraversalCache {
  private readonly entries = new Map<string, Set<any>>()
  private readonly keysByClass = new Map<Ref<Class<Doc>>, Set<string>>()

  get (key: string): Set<any> | undefined {
    return this.entries.get(key)
  }

  set (key: string, _class: Ref<Class<Doc>>, values: Set<any>): void {
    this.entries.set(key, values)
    let keys = this.keysByClass.get(_class)
    if (keys === undefined) {
      keys = new Set<string>()
      this.keysByClass.set(_class, keys)
    }
    keys.add(key)
  }

  /** Drops every cached step reading `_class`. */
  invalidate (_class: Ref<Class<Doc>>): void {
    const keys = this.keysByClass.get(_class)
    if (keys === undefined) return
    for (const key of keys) this.entries.delete(key)
    this.keysByClass.delete(_class)
  }

  clear (): void {
    this.entries.clear()
    this.keysByClass.clear()
  }
}

/** A step whose class comes from the row can only be resolved with that row in hand. */
function stepClass (step: TraversalStep, doc: Doc | undefined): Ref<Class<Doc>> | undefined {
  if (typeof step.via === 'string') return step.via
  const value = (doc as unknown as Record<string, unknown> | undefined)?.[step.via.classFromField]
  return typeof value === 'string' ? (value as Ref<Class<Doc>>) : undefined
}

export function pathNeedsDocument (path: RelationPath): boolean {
  return path.steps.some((step) => typeof step.via !== 'string')
}

/** Stable ordering for cache keys; values are ids or uuids, so string order is enough. */
function compareValues (a: any, b: any): number {
  return String(a).localeCompare(String(b))
}

function normalizeIdentity (value: string | string[] | undefined): any[] | undefined {
  if (value === undefined) return undefined
  const values = Array.isArray(value) ? value : [value]
  return values.length === 0 ? undefined : values
}

/** Applies `core.mixin.RowVisibility` (if declared) to a `findAll` query. */
export class RowVisibilityResolver {
  constructor (
    private readonly next: Middleware | undefined,
    private readonly constraints: NamedConstraintResolver = defaultConstraintResolver,
    private readonly cache: TraversalCache = new TraversalCache()
  ) {}

  invalidate (_class: Ref<Class<Doc>>): void {
    this.cache.invalidate(_class)
  }

  hasPolicy (hierarchy: Hierarchy, _class: Ref<Class<Doc>>): boolean {
    // Some focused middleware tests use a minimal hierarchy double that only implements the
    // methods exercised by the scenario. A real Hierarchy always provides this method.
    if (typeof hierarchy.classHierarchyMixin !== 'function') return false
    return hierarchy.classHierarchyMixin(_class, core.mixin.RowVisibility) !== undefined
  }

  /**
   * Whether the class's read policy actually narrows rows. `spaceScoped` and `spaceMember`
   * declare the absence of a row rule, so a class carrying them is protected by space access
   * alone and must keep whatever space-level exclusions apply to it.
   */
  restrictsRows (hierarchy: Hierarchy, _class: Ref<Class<Doc>>): boolean {
    if (typeof hierarchy.classHierarchyMixin !== 'function') return false
    const mixin = hierarchy.classHierarchyMixin(_class, core.mixin.RowVisibility)
    if (mixin === undefined) return false
    return mixin.policy.kind === 'relation' || mixin.policy.kind === 'denyAll'
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

  /**
   * The values of `path.to` the caller may reach. `undefined` means "no access", which is also
   * what an overflowing or unsatisfiable traversal returns - never "everything".
   */
  async resolveTargets (
    ctx: MeasureContext<SessionData>,
    path: RelationPath,
    identity: AccountIdentityResolver,
    doc?: Doc
  ): Promise<Set<any> | undefined> {
    const self = normalizeIdentity(await identity.resolve(path.from))
    if (self === undefined) return undefined
    if (path.steps.length > MAX_TRAVERSAL_DEPTH) return undefined
    let values = self

    const lastIndex = path.steps.length - 1
    for (const [index, step] of path.steps.entries()) {
      const via = stepClass(step, doc)
      if (via === undefined) return undefined
      // Per-document evaluation asks a yes/no question about one value, so the final step is
      // narrowed to that value instead of enumerating everything the caller can reach.
      const expected =
        doc !== undefined && index === lastIndex
          ? (doc as unknown as Record<string, unknown>)[path.to ?? '_id']
          : undefined
      const cacheKey = `${via}|${step.match}|${step.emit}|${step.where ?? ''}|${String(expected ?? '')}|${
        step.keepIncoming === true ? 'k' : ''
      }|${values.slice().sort(compareValues).join(',')}`
      const cached = this.cache.get(cacheKey)
      let emitted: Set<any>
      if (cached !== undefined) {
        emitted = cached
      } else {
        // A single value is matched directly rather than through `$in`: same semantics, a
        // cheaper query, and the shape the storage adapters index best.
        const matchValue = values.length === 1 ? values[0] : { $in: values }
        let stepQuery: DocumentQuery<Doc> = { [step.match]: matchValue } as unknown as DocumentQuery<Doc>
        if (expected !== undefined) {
          stepQuery = { ...stepQuery, [step.emit]: expected } as unknown as DocumentQuery<Doc>
        }
        if (step.where !== undefined) {
          const constraint = this.constraints(step.where, via)
          if (constraint === undefined) return undefined
          stepQuery = { ...stepQuery, ...constraint }
        }
        const projection: Record<string, 1> = { [step.emit]: 1 }
        const docs = ((await this.next?.findAll(ctx, via, stepQuery, { projection })) ?? []) as Array<
        Record<string, unknown>
        >
        emitted = new Set<any>()
        for (const doc of docs) {
          const value = doc[step.emit]
          if (Array.isArray(value)) {
            for (const item of value) emitted.add(item)
          } else if (value !== undefined && value !== null) {
            emitted.add(value)
          }
          if (emitted.size > MAX_TRAVERSAL_VALUES) return undefined
        }
        this.cache.set(cacheKey, via, emitted)
      }

      const next = new Set<any>(emitted)
      if (step.keepIncoming === true) {
        for (const value of values) next.add(value)
      }
      if (next.size > MAX_TRAVERSAL_VALUES) return undefined
      if (next.size === 0) {
        // Nothing reachable. With `includeSelf` the caller still sees its own row, otherwise the
        // policy denies.
        return path.includeSelf === true ? new Set<any>(self) : undefined
      }
      values = Array.from(next)
    }

    const result = new Set<any>(values)
    if (path.includeSelf === true) {
      for (const value of self) result.add(value)
    }
    return result
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
      case 'relation': {
        // Ownership (a path of length zero) is verified against the document being created, and
        // so is a document-relative path - the parent it points at already exists. A link-based
        // path over a fixed class cannot be: the link record does not exist yet.
        if (pathNeedsDocument(policy.path)) {
          return await this.matchesDocument(ctx, policy.path, doc, identity)
        }
        if (policy.path.steps.length > 0) return false
        const value = await identity.resolve(policy.path.from)
        const field = policy.path.to ?? '_id'
        return identityMatches((doc as unknown as Record<string, unknown>)[field], value)
      }
      case 'spaceMember':
      case 'spaceScoped':
        return true
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
    if (policy.kind !== 'relation') return true

    const updated =
      tx._class === core.class.TxMixin
        ? TxProcessor.updateMixin4Doc({ ...doc }, tx as TxMixin<Doc, Doc>)
        : TxProcessor.updateDoc2Doc({ ...doc }, tx as TxUpdateDoc<Doc>)
    const updatedFields = updated as unknown as Record<string, unknown>
    const field = policy.path.to ?? '_id'

    if (pathNeedsDocument(policy.path)) {
      return await this.matchesDocument(ctx, policy.path, updated, identity)
    }

    if (policy.path.steps.length === 0) {
      const value = await identity.resolve(policy.path.from)
      return identityMatches(updatedFields[field], value)
    }

    const allowed = await this.resolveTargets(ctx, policy.path, identity)
    if (allowed === undefined) return false
    return allowed.has(updatedFields[field])
  }

  /** Evaluates a path against one document. Used where a query cannot carry the policy. */
  async matchesDocument (
    ctx: MeasureContext<SessionData>,
    path: RelationPath,
    doc: Doc,
    identity: AccountIdentityResolver
  ): Promise<boolean> {
    const allowed = await this.resolveTargets(ctx, path, identity, doc)
    if (allowed === undefined) return false
    return allowed.has((doc as unknown as Record<string, unknown>)[path.to ?? '_id'])
  }

  /** Write-side check for a row already fetched, when `resolveMutation` said `perDocument`. */
  async canMutateDocument (
    hierarchy: Hierarchy,
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<Doc>>,
    doc: Doc,
    identity: AccountIdentityResolver
  ): Promise<boolean> {
    if (typeof hierarchy.classHierarchyMixin !== 'function') return true
    const mixin = hierarchy.classHierarchyMixin(_class, core.mixin.RowVisibility)
    if (mixin === undefined) return true
    const policy = getWritePolicy(mixin)
    if (policy.kind !== 'relation') return policy.kind !== 'denyAll'
    return await this.matchesDocument(ctx, policy.path, doc, identity)
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

      case 'relation': {
        if (pathNeedsDocument(policy.path)) return { kind: 'perDocument' }
        const allowed = await this.resolveTargets(ctx, policy.path, identity)
        if (allowed === undefined) return { kind: 'deny' }
        const field = policy.path.to ?? '_id'
        const merged =
          allowed.size === 1
            ? mergeEquals(query, field, Array.from(allowed)[0])
            : mergeIn(query, field, allowed)
        return merged === undefined ? { kind: 'deny' } : { kind: 'narrow', query: merged }
      }
    }
  }
}
