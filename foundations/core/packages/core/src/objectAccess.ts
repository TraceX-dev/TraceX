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
 * Object access control: an object with the `AccessControlled` mixin (a security root) narrows who can see
 * it and everything that belongs to it inside its space. The server marks the root and its descendants with
 * `accessRoot`. See foundations/server/docs/object-access-control.md.
 */

import type { AccountUuid, Class, Collaborator, Doc, Ref } from './classes'
import core from './component'
import type { Hierarchy } from './hierarchy'
import type { DocumentQuery, FindOptions, Projection } from './storage'

/**
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
 * Who reads (and writes): the space, collaborators of the parent object, or members of the object.
 * @public
 */
export type AccessAudience = SpaceAudience | ParentParticipantsAudience | MembersAudience

/**
 * @public
 */
export interface AccessControlled extends Doc {
  read: AccessAudience
  owners?: AccountUuid[] // server-managed: the creator
}

/**
 * @public
 */
export interface AccessRefField {
  field: string
  classField: string
}

/**
 * Enables object access control for a class.
 * @public
 */
export interface ClassAccessPolicy extends Class<Doc> {
  membersField: string // AccountUuid[] used by the `members` audience
  parent?: AccessRefField // default: attachedTo
}

/**
 * Opts a class in: its documents belong to the root their reference fields lead to; the first resolved wins.
 * Classes without it (and without a policy) are never checked.
 * @public
 */
export interface AccessParent extends Class<Doc> {
  parents: AccessRefField[]
}

/**
 * @public
 */
export type ObjectVisibility = 'public' | 'participants' | 'private'

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
  switch (audience?.kind) {
    case 'parentParticipants':
      return 'participants'
    case 'members':
      return 'private'
    default:
      return 'public'
  }
}

/**
 * @public
 */
export function isAccessAudience (value: unknown): value is AccessAudience {
  const kind = (value as { kind?: unknown } | null | undefined)?.kind
  return kind === 'space' || kind === 'parentParticipants' || kind === 'members'
}

/**
 * @public
 */
export function getAccessRoot (doc: object): Ref<Doc> | undefined {
  const root = (doc as AccessMarked).accessRoot
  return typeof root === 'string' && root !== '' ? root : undefined
}

const accessRootProjection: Record<string, 1> = { _id: 1, [ACCESS_ROOT_FIELD]: 1 }

/**
 * Projection reading only the mark.
 * @public
 */
export const ACCESS_ROOT_PROJECTION: Projection<Doc> = accessRootProjection

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
  if (!hierarchy.hasClass(_class)) return []
  return hierarchy.classHierarchyMixin(_class, core.mixin.AccessParent)?.parents ?? []
}

/**
 * @public
 */
export function getAccessAudience (hierarchy: Hierarchy, doc: Doc): AccessAudience | undefined {
  if (!hierarchy.hasMixin(doc, core.mixin.AccessControlled)) return undefined
  const read = hierarchy.as(doc, core.mixin.AccessControlled).read
  return isAccessAudience(read) ? read : undefined
}

/**
 * @public
 */
export function getAccessOwners (hierarchy: Hierarchy, doc: Doc): AccountUuid[] {
  if (!hierarchy.hasMixin(doc, core.mixin.AccessControlled)) return []
  const owners = hierarchy.as(doc, core.mixin.AccessControlled).owners
  return Array.isArray(owners) ? owners.filter((it) => typeof it === 'string') : []
}

/**
 * True when update operations touch the attribute, including dotted paths (`field.x`).
 * @public
 */
export function touchesAttribute (ops: Record<string, any>, attribute: string): boolean {
  const matches = (key: string): boolean => key === attribute || key.startsWith(`${attribute}.`)
  return Object.keys(ops).some(
    (key) => matches(key) || (key.startsWith('$') && Object.keys(ops[key] ?? {}).some(matches))
  )
}

/**
 * @public
 */
export function getAccessMembers (doc: Doc, policy: ClassAccessPolicy): AccountUuid[] {
  const value = (doc as unknown as Record<string, unknown>)[policy.membersField]
  return Array.isArray(value) ? value.filter((it): it is AccountUuid => typeof it === 'string') : []
}

/**
 * Readers of a root, or `undefined` when the policy does not narrow the space.
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
export type AccessFindFn = <T extends Doc>(
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>,
  options?: FindOptions<T>
) => Promise<T[]>

/**
 * Classes declaring a policy; a query by them also returns their subclasses.
 * @public
 */
export function getAccessPolicyClasses (hierarchy: Hierarchy): Ref<Class<Doc>>[] {
  let result = policyClasses.get(hierarchy)
  if (result === undefined) {
    result = hierarchy
      .getDescendants(core.class.Doc)
      .filter(
        (it) => !hierarchy.isMixin(it) && hierarchy.hasMixin(hierarchy.getClass(it), core.mixin.ClassAccessPolicy)
      )
    policyClasses.set(hierarchy, result)
  }
  return result
}

const policyClasses = new WeakMap<Hierarchy, Array<Ref<Class<Doc>>>>()

/**
 * Drops the cached policy classes after a model change.
 * @public
 */
export function resetAccessPolicyClasses (hierarchy: Hierarchy): void {
  policyClasses.delete(hierarchy)
}

/**
 * Readers of the root a document belongs to (for triggers): `undefined` when not restricted,
 * an empty set when the root cannot be resolved (fail-closed).
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
  for (const _class of root === undefined ? getAccessPolicyClasses(hierarchy) : []) {
    root = (await find(_class, { _id: rootId }, { limit: 1 }))[0]
    if (root !== undefined) break
  }
  const policy = root !== undefined ? getClassAccessPolicy(hierarchy, root._class) : undefined
  if (root === undefined || policy === undefined || getAccessRoot(root) !== root._id) return new Set()
  // Every document of a class with a policy is a root; without the mixin it is public.
  const audience = getAccessAudience(hierarchy, root) ?? { kind: 'space' }

  let participants: AccountUuid[] | undefined
  const parentId = (root as unknown as Record<string, unknown>)[(policy.parent ?? DEFAULT_ACCESS_PARENT).field]
  if (audience.kind === 'parentParticipants' && typeof parentId === 'string') {
    const collaborators = await find(core.class.Collaborator, { attachedTo: parentId as Ref<Doc> })
    participants = collaborators.map((it: Collaborator) => it.collaborator)
  }
  return getAccessReaders(audience, getAccessMembers(root, policy), participants)
}
