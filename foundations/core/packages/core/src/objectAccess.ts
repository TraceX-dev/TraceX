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
 * Object-level access control.
 *
 * An object of a class with a `ClassAccessPolicy` may carry the `AccessControlled` mixin, which narrows
 * who can see it inside its space. Such an object is a "security root". Every document that belongs to a
 * root (messages, replies, reactions, attachments, activity, notifications...) is marked by the server
 * with the `accessRoot` field, so a single query condition hides the whole subtree.
 *
 * Access is always: space access ∩ object policy. The policy can only narrow, never widen.
 */

import type { AccountUuid, Class, Collaborator, Doc, Ref } from './classes'
import core from './component'
import type { Hierarchy } from './hierarchy'
import type { DocumentQuery, FindOptions } from './storage'
import type { DocumentUpdate } from './tx'

/**
 * Field the server sets on a security root (pointing to itself) and on all of its descendants.
 * Documents without the field are not restricted by object policies.
 * @public
 */
export const ACCESS_ROOT_FIELD = 'accessRoot'

/**
 * @public
 */
export interface AccessMarked {
  accessRoot?: Ref<Doc>
}

/**
 * Who may read (and write) a security root and its descendants.
 *
 * - `space` — everyone with access to the space (the object is public, but stays marked so its level can
 *   be narrowed again without re-marking the subtree);
 * - `parentParticipants` — the participants of the parent object (by default its collaborators);
 * - `members` — only the members of the object itself.
 *
 * Members of the object matter only for `members`; the other levels are defined by the space or the parent.
 * @public
 */
export type AccessAudience = SpaceAudience | ParentParticipantsAudience | MembersAudience

/**
 * @public
 */
export interface SpaceAudience {
  kind: 'space'
}

/**
 * @public
 */
export interface ParentParticipantsAudience {
  kind: 'parentParticipants'
}

/**
 * @public
 */
export interface MembersAudience {
  kind: 'members'
}

/**
 * @public
 */
export type AccessAudienceKind = AccessAudience['kind']

/**
 * The mixin is set on the security root itself.
 * @public
 */
export interface AccessControlled extends Doc {
  read: AccessAudience
  // Accounts that manage the policy and membership (server-managed: the creator of the object).
  owners?: AccountUuid[]
}

/**
 * A reference attribute together with the attribute holding the class of the referenced document.
 * @public
 */
export interface AccessRefField {
  field: string
  classField: string
}

/**
 * Enables object-level access control for a class.
 * @public
 */
export interface ClassAccessPolicy extends Class<Doc> {
  // Attribute with AccountUuid[] of the object members, used by the `members` audience.
  membersField: string
  // Parent whose participants are used by the `parentParticipants` audience. Defaults to attachedTo.
  parent?: AccessRefField
}

/**
 * Declares how a document of the class is linked to a security root.
 * Defaults to `attachedTo` for every document that has it.
 * The first reference that leads to a security root wins.
 * @public
 */
export interface AccessParent extends Class<Doc> {
  parents: AccessRefField[]
}

/**
 * Declares who the participants of a parent object are, for the `parentParticipants` audience.
 * Without the mixin the participants are the object collaborators (`core.class.Collaborator`).
 * @public
 */
export interface AccessParticipants extends Class<Doc> {
  // Attribute with AccountUuid[]; when omitted, collaborators are used.
  membersField?: string
}

/**
 * UI level of an object, mapped onto an audience.
 * @public
 */
export type ObjectVisibility = 'public' | 'participants' | 'private'

/**
 * @public
 */
export const objectVisibilities: ObjectVisibility[] = ['public', 'participants', 'private']

/**
 * @public
 */
export const DEFAULT_ACCESS_PARENT: AccessRefField = { field: 'attachedTo', classField: 'attachedToClass' }

/**
 * @public
 */
export function visibilityToAudience (visibility: ObjectVisibility): AccessAudience {
  switch (visibility) {
    case 'public':
      return { kind: 'space' }
    case 'participants':
      return { kind: 'parentParticipants' }
    case 'private':
      return { kind: 'members' }
  }
}

/**
 * @public
 */
export function audienceToVisibility (audience: AccessAudience | undefined): ObjectVisibility {
  if (audience === undefined) return 'public'
  switch (audience.kind) {
    case 'space':
      return 'public'
    case 'parentParticipants':
      return 'participants'
    case 'members':
      return 'private'
  }
}

/**
 * @public
 */
export function isAccessAudience (value: unknown): value is AccessAudience {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'space' || kind === 'parentParticipants' || kind === 'members'
}

/**
 * True when the audience narrows access below the space.
 * @public
 */
export function isRestrictedAudience (audience: AccessAudience | undefined): boolean {
  return audience !== undefined && audience.kind !== 'space'
}

/**
 * @public
 */
export function getAccessRoot (doc: object): Ref<Doc> | undefined {
  const root = (doc as AccessMarked).accessRoot
  return typeof root === 'string' && root !== '' ? root : undefined
}

/**
 * Update operations that set the mark (server-side, raw updates).
 * @public
 */
export function makeAccessRootUpdate (root: Ref<Doc>): DocumentUpdate<Doc> {
  const ops: AccessMarked = { accessRoot: root }
  return ops as DocumentUpdate<Doc>
}

/**
 * @public
 */
export function getClassAccessPolicy (hierarchy: Hierarchy, _class: Ref<Class<Doc>>): ClassAccessPolicy | undefined {
  if (!hierarchy.hasClass(_class)) return undefined
  return hierarchy.classHierarchyMixin(_class, core.mixin.ClassAccessPolicy)
}

/**
 * @public
 */
export function getAccessParents (hierarchy: Hierarchy, _class: Ref<Class<Doc>>): AccessRefField[] {
  if (!hierarchy.hasClass(_class)) return [DEFAULT_ACCESS_PARENT]
  return hierarchy.classHierarchyMixin(_class, core.mixin.AccessParent)?.parents ?? [DEFAULT_ACCESS_PARENT]
}

/**
 * @public
 */
export function getAccessParticipants (hierarchy: Hierarchy, _class: Ref<Class<Doc>>): AccessParticipants | undefined {
  if (!hierarchy.hasClass(_class)) return undefined
  return hierarchy.classHierarchyMixin(_class, core.mixin.AccessParticipants)
}

/**
 * The audience stored on a document, if any.
 * @public
 */
export function getAccessAudience (hierarchy: Hierarchy, doc: Doc): AccessAudience | undefined {
  if (!hierarchy.hasMixin(doc, core.mixin.AccessControlled)) return undefined
  const read = hierarchy.as(doc, core.mixin.AccessControlled).read
  return isAccessAudience(read) ? read : undefined
}

/**
 * Owners stored in the policy of a document.
 * @public
 */
export function getAccessOwners (hierarchy: Hierarchy, doc: Doc): AccountUuid[] {
  if (!hierarchy.hasMixin(doc, core.mixin.AccessControlled)) return []
  const owners = hierarchy.as(doc, core.mixin.AccessControlled).owners
  return Array.isArray(owners) ? owners.filter((it) => typeof it === 'string') : []
}

/**
 * True when update operations touch the attribute, including dotted paths (`field.x`) at any level.
 * @public
 */
export function touchesAttribute (ops: Record<string, any>, attribute: string): boolean {
  const matches = (key: string): boolean => key === attribute || key.startsWith(`${attribute}.`)
  for (const key of Object.keys(ops)) {
    if (matches(key)) return true
    const value = ops[key]
    if (key.startsWith('$') && typeof value === 'object' && value !== null) {
      if (Object.keys(value).some(matches)) return true
    }
  }
  return false
}

/**
 * @public
 */
export function getAccessMembers (doc: Doc, policy: ClassAccessPolicy): AccountUuid[] {
  const value = (doc as unknown as Record<string, unknown>)[policy.membersField]
  return Array.isArray(value) ? (value.filter((it) => typeof it === 'string') as AccountUuid[]) : []
}

/**
 * Accounts that may read a security root, or `undefined` when the policy does not narrow the space.
 * @public
 */
export function getAccessReaders (
  audience: AccessAudience,
  members: Iterable<AccountUuid>,
  parentParticipants: Iterable<AccountUuid> | undefined
): Set<AccountUuid> | undefined {
  switch (audience.kind) {
    case 'space':
      return undefined
    case 'parentParticipants':
      return new Set(parentParticipants ?? [])
    case 'members':
      return new Set(members)
  }
}

/**
 * @public
 */
export function canReadByAudience (
  account: AccountUuid,
  audience: AccessAudience,
  members: ReadonlySet<AccountUuid>,
  parentParticipants: ReadonlySet<AccountUuid> | undefined
): boolean {
  switch (audience.kind) {
    case 'space':
      return true
    case 'parentParticipants':
      return parentParticipants?.has(account) === true
    case 'members':
      return members.has(account)
  }
}

/**
 * Unrestricted find used to resolve readers outside of the security middlewares (e.g. in triggers).
 * @public
 */
export type AccessFindFn = <T extends Doc>(
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>,
  options?: FindOptions<T>
) => Promise<T[]>

/**
 * Classes that declare an access policy. A query by such a class also returns its subclasses,
 * so these are enough to find every security root.
 * @public
 */
export function getAccessPolicyClasses (hierarchy: Hierarchy): Ref<Class<Doc>>[] {
  return hierarchy.getDescendants(core.class.Doc).filter((_class) => {
    if (hierarchy.isMixin(_class)) return false
    return hierarchy.hasMixin(hierarchy.getClass(_class), core.mixin.ClassAccessPolicy)
  })
}

/**
 * Readers of the restricted object a document belongs to (by its `accessRoot` mark).
 * Returns `undefined` when the document is not restricted. Fails closed (an empty set) when the
 * root cannot be resolved.
 * @public
 */
export async function getObjectAccessReaders (
  hierarchy: Hierarchy,
  find: AccessFindFn,
  doc: Doc
): Promise<Set<AccountUuid> | undefined> {
  const rootId = getAccessRoot(doc)
  if (rootId === undefined) return undefined
  let root: Doc | undefined = rootId === doc._id ? doc : undefined
  if (root === undefined) {
    for (const _class of getAccessPolicyClasses(hierarchy)) {
      root = (await find(_class, { _id: rootId }, { limit: 1 }))[0]
      if (root !== undefined) break
    }
  }
  if (root === undefined) return new Set()
  const policy = getClassAccessPolicy(hierarchy, root._class)
  const audience = getAccessAudience(hierarchy, root)
  if (policy === undefined || audience === undefined) return new Set()
  if (audience.kind === 'space') return undefined

  let participants: AccountUuid[] | undefined
  if (audience.kind === 'parentParticipants') {
    const parentRef = policy.parent ?? DEFAULT_ACCESS_PARENT
    const record = root as unknown as Record<string, unknown>
    const parentId = record[parentRef.field]
    const parentClass = record[parentRef.classField]
    if (typeof parentId === 'string' && typeof parentClass === 'string') {
      const _class = parentClass as Ref<Class<Doc>>
      const _id = parentId as Ref<Doc>
      const field = getAccessParticipants(hierarchy, _class)?.membersField
      if (field === undefined) {
        const collaborators = await find(core.class.Collaborator, { attachedTo: _id })
        participants = collaborators.map((it: Collaborator) => it.collaborator)
      } else if (hierarchy.hasClass(_class)) {
        const parent = (await find(_class, { _id }, { limit: 1 }))[0]
        const value = (parent as unknown as Record<string, unknown> | undefined)?.[field]
        participants = Array.isArray(value) ? value.filter((it): it is AccountUuid => typeof it === 'string') : []
      }
    }
  }
  return getAccessReaders(audience, getAccessMembers(root, policy), participants)
}
