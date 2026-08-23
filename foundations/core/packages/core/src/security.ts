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

/**
 * Declarative types for the restricted-role ("guest") security model. Full write-up in
 * `docs/security-model.md` - short version:
 *
 * - `roleOrder` / `isRowLevelRestricted` decide *which* accounts this model applies to: any role
 *   ordered below `AccountRole.User` (`ReadOnlyGuest`, `DocGuest`, `Guest`, and any future role
 *   added below `User`). `AccountRole.User` and above bypass both layers below entirely.
 *
 * - Layer 1 (class/action access - "may this role reach this class/tx kind at all") is enforced by
 *   `foundations/server/packages/middleware/src/accessGate.ts`, combining the code-declared
 *   `TxAccessLevel` mixin below with the admin-configurable `ModulePermissionGroup` /
 *   `ClassPermission` docs (declared in `./classes`, alongside the rest of the general permission
 *   system - roles, `Permission` scopes - that they're part of).
 *
 * - Layer 2 (row visibility - "which rows of an already-reachable class may this role see or
 *   touch") is enforced by `foundations/server/packages/middleware/src/rowVisibility.ts`,
 *   evaluating the `RowVisibility` mixin below. Declared once per class, next to the class, by the
 *   plugin author - never admin-configurable, unlike Layer 1's permission groups.
 *
 * Both mixins are declared with `builder.mixin(...)` and read identically on client and server via
 * `hierarchy.classHierarchyMixin`.
 * @public
 */

import { AccountRole, type Class, type Doc, type Ref } from './classes'

/**
 * Relative ordering of `AccountRole` values, low to high. The single source of truth for "is this
 * role more or less privileged than that one" - prefer `isRowLevelRestricted` / `hasAccountRole`
 * (`./utils`) over comparing `AccountRole` values directly.
 * @public
 */
export const roleOrder: Record<AccountRole, number> = {
  [AccountRole.ReadOnlyGuest]: 5,
  [AccountRole.DocGuest]: 10,
  [AccountRole.Guest]: 20,
  [AccountRole.User]: 30,
  [AccountRole.Maintainer]: 40,
  [AccountRole.Owner]: 50,
  [AccountRole.Admin]: 100
}

/**
 * True for any role below `AccountRole.User` (`Guest`, `DocGuest`, `ReadOnlyGuest`, and any future
 * role added below `User`). The single source of truth for "restricted account" - use this instead
 * of enumerating guest roles explicitly, so a new restricted role is covered automatically.
 * @public
 */
export function isRowLevelRestricted (role: AccountRole): boolean {
  return roleOrder[role] < roleOrder[AccountRole.User]
}

/**
 * Layer 1: code-declared minimum role for create/update/remove on a class, independent of any
 * admin-configured `ModulePermissionGroup`/`ClassPermission`. Declared with
 * `builder.mixin(SomeClass, core.class.Class, core.mixin.TxAccessLevel, {...})`.
 * @public
 */
export interface TxAccessLevel extends Class<Doc> {
  createAccessLevel?: AccountRole
  removeAccessLevel?: AccountRole
  updateAccessLevel?: AccountRole
  isIdentity?: boolean
}

/**
 * Identity an account resolves to for `RowVisibilityPolicy` comparisons. `socialId` is the primary
 * social identity used to author documents. `linkId` comes from a session's own token claims (see
 * `guest.class.PublicLink`), not from account/person data.
 * @public
 */
export type IdentityKind = 'accountUuid' | 'personId' | 'socialId' | 'linkId'

/**
 * Structural fact about how a class stores row-level ownership, for classes not scoped by
 * ordinary space membership. Decided once by the plugin author, never admin-configurable.
 * @public
 */
export type RowVisibilityPolicy =
  // instance[field] must equal the resolved identity value
  | { kind: 'ownerField', field: string, identity: IdentityKind }
  // ownership via a separate link record: linkClass docs where linkIdentityField equals the
  // resolved identity and linkTargetField equals the protected document's targetField (default _id)
  | {
    kind: 'linkedViaRecord'
    linkClass: Ref<Class<Doc>>
    linkTargetField: string
    linkIdentityField: string
    identity: IdentityKind
    /** Field on the protected document containing the linked target. Defaults to `_id`. */
    targetField?: string
    /** Optionally maps linked ids through another class before narrowing the protected document. */
    through?: {
      documentClass: Ref<Class<Doc>>
      sourceField: string
      targetField: string
      includeDirect?: boolean
    }
  }
  // visibility follows ordinary membership in a real (non-system) space
  | { kind: 'spaceMember' }
  // no way to verify ownership - always denied (subject to allowKnownIdBypass)
  | { kind: 'denyAll' }
  // deliberately public for any role Layer 1 allows in; reason required for review
  | { kind: 'publicReadable', reason: string }

/**
 * Row-level ownership policy for classes not covered by ordinary space-based filtering. Declared
 * next to the class (`builder.mixin(SomeClass, core.class.Class, core.mixin.RowVisibility, {...})`),
 * read via `hierarchy.classHierarchyMixin` identically on client and server.
 *
 * Any class reachable by a restricted role in a shared or system space is expected to either
 * declare this mixin or be covered by an explicit exemption - see
 * `foundations/server/packages/middleware/src/tests/rowVisibilityInvariant.test.ts`, which fails
 * the build when a new such class has neither.
 * @public
 */
export interface RowVisibility extends Class<Doc> {
  policy: RowVisibilityPolicy
  /** Optional stricter policy for create/update/remove. Defaults to `policy`. */
  writePolicy?: RowVisibilityPolicy
  /**
   * Whether a query already narrowing one of `knownIdBypassFields` may skip the policy check,
   * trusting the caller obtained that reference from a document it can already see. Must be
   * `false` when the referenced value doubles as a secret (e.g. `guest.class.PublicLink._id`).
   */
  allowKnownIdBypass: boolean
  /** Fields (besides `_id`) that count as a known reference for `allowKnownIdBypass`, when the
   * trust anchor differs from `policy`'s own field. Defaults to `[]` (only `_id`). */
  knownIdBypassFields?: string[]
  /**
   * Opts this class into `GuestActivitySettings.activityScope`: restricted-role reads of an
   * `AttachedDoc` (chat message, etc.) whose `attachedToClass` is this class get narrowed to the
   * caller's own activity or activity on documents it collaborates on, per that setting - instead
   * of the attached class's own (often `publicReadable`) policy. Set only on classes meant to be
   * "personal" documents (e.g. card.class.Card); leave unset for shared spaces like channels,
   * where every member should keep seeing all activity regardless of this setting.
   */
  scopeActivityToOwner?: boolean
}

/**
 * Which activity a restricted-role account may read on a document it doesn't own outright: only
 * activity it authored itself, activity on documents where it's a listed `core.class.Collaborator`,
 * or (today's behavior) any it can already read via ordinary visibility.
 * @public
 */
export enum GuestActivityScope {
  Own = 'own',
  Collaborator = 'collaborator',
  Any = 'any'
}

/**
 * Per-role setting for restricted-role activity visibility - the one guest-permission concern in
 * this codebase that doesn't fit a `ModulePermissionGroup`/`ClassPermission` toggle (see
 * `GuestActivityScope`; it's a three-way choice, not on/off) or a static `TxAccessLevel`. Defaults
 * to `GuestActivityScope.Any` (today's behavior) when no doc exists for a role. One doc per role.
 * @public
 */
export interface GuestActivitySettings extends Doc {
  role: AccountRole
  /** Activity/message visibility on documents using the ownerField write-policy pattern
   *  (see `RowVisibility.writePolicy`) - e.g. card.class.Card. Defaults to `Any`. */
  activityScope: GuestActivityScope
}
