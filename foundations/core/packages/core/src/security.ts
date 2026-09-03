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

import { AccountRole, type Class, type Doc, type Ref } from './classes'

/**
 * Relative ordering of `AccountRole` values, low to high.
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
 * True for any role below `AccountRole.User`.
 * @public
 */
export function isRowLevelRestricted (role: AccountRole): boolean {
  return roleOrder[role] < roleOrder[AccountRole.User]
}

/**
 * Code-declared minimum role for create, update, and remove operations.
 * @public
 */
export interface TxAccessLevel extends Class<Doc> {
  createAccessLevel?: AccountRole
  removeAccessLevel?: AccountRole
  updateAccessLevel?: AccountRole
  isIdentity?: boolean
  /** Allows non-business-data mutations required for viewer presence and UI state. */
  allowViewerWrite?: boolean
}

/**
 * Identity used by a row-visibility policy.
 * @public
 */
export type IdentityKind = 'accountUuid' | 'personId' | 'socialId' | 'linkId'

/**
 * How a class derives row-level access for restricted roles.
 * @public
 */
export type RowVisibilityPolicy =
  | { kind: 'ownerField', field: string, identity: IdentityKind }
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
  | { kind: 'spaceMember' }
  | { kind: 'denyAll' }
  | { kind: 'spaceScoped', reason: string }

/**
 * Row-level access policy declared on a class.
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
  /** Enables known-reference lookup. Omitted values are treated as `false`. */
  allowKnownIdBypass?: boolean
  /** Required justification when `allowKnownIdBypass` is enabled. */
  knownIdBypassReason?: string
  /** Additional fields that count as known references. */
  knownIdBypassFields?: string[]
  /**
   * Opts this class into `GuestActivitySettings.activityScope`: restricted-role reads of an
   * `AttachedDoc` (chat message, etc.) whose `attachedToClass` is this class get narrowed to the
   * caller's own activity or activity on documents it collaborates on, per that setting - instead
   * of the attached class's own (often `spaceScoped`) policy. Set only on classes meant to be
   * "personal" documents (e.g. card.class.Card); leave unset for shared spaces like channels,
   * where every member should keep seeing all activity regardless of this setting.
   */
  scopeActivityToOwner?: boolean
}

/**
 * Activity visible to a restricted-role account on a personal document.
 * @public
 */
export enum GuestActivityScope {
  Own = 'own',
  Collaborator = 'collaborator',
  Any = 'any'
}

export enum GuestSecurityProfile {
  Viewer = 'viewer',
  Participant = 'participant',
  Advanced = 'advanced',
  Custom = 'custom'
}

/**
 * Per-role security profile and advanced activity visibility settings.
 * @public
 */
export interface GuestActivitySettings extends Doc {
  role: AccountRole
  securityProfile?: GuestSecurityProfile
  /** Activity visibility on classes that opt into this setting. */
  activityScope: GuestActivityScope
}

export function ownBy (field: string, identity: IdentityKind): RowVisibilityPolicy {
  return { kind: 'ownerField', field, identity }
}

export function linkedViaCollaborator (
  linkClass: Ref<Class<Doc>>,
  linkTargetField: string,
  linkIdentityField: string,
  identity: IdentityKind,
  options?: Pick<Extract<RowVisibilityPolicy, { kind: 'linkedViaRecord' }>, 'targetField' | 'through'>
): RowVisibilityPolicy {
  return {
    kind: 'linkedViaRecord',
    linkClass,
    linkTargetField,
    linkIdentityField,
    identity,
    ...options
  }
}

export function spaceScoped (reason: string): RowVisibilityPolicy {
  return { kind: 'spaceScoped', reason }
}
