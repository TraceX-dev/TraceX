//
// Copyright © 2025 Hardcore Engineering Inc.
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

import core, { AccountUuid, AttachedDoc, Class, ClassCollaborators, Doc, Hierarchy, ModelDb, Ref, Space } from '.'

export function getClassCollaborators<T extends Doc> (
  model: ModelDb,
  hiearachy: Hierarchy,
  _id: Ref<Class<T>>
): ClassCollaborators<T> | undefined {
  const ancestors = hiearachy.getAncestors(_id)
  const collabs = new Map(
    model
      .findAllSync(core.class.ClassCollaborators, {
        attachedTo: { $in: ancestors }
      })
      .map((c) => [c.attachedTo, c])
  )
  for (const ancestor of ancestors) {
    const res = collabs.get(ancestor)
    if (res !== undefined) {
      return res
    }
  }
}

/**
 * Space part of the read security the storage applies to guests: the shared and system spaces, and
 * non-archived spaces the guest is a member of. Keep in sync with the storage adapters.
 *
 * @public
 */
export function isSpaceReadableByGuest (space: Space | undefined, account: AccountUuid): boolean {
  if (space === undefined || space.archived) return false
  return space._id === core.space.Space || space._class === core.class.SystemSpace || space.members.includes(account)
}

/**
 * Documents whose collaborators may read `doc` although its space is not readable: the document itself
 * with `provideSecurity`, the document it is attached to with `provideAttachedSecurity`.
 *
 * @public
 */
export function getGuestReadCollaboratorTargets (model: ModelDb, hierarchy: Hierarchy, doc: Doc): Array<Ref<Doc>> {
  const collabSec = getClassCollaborators(model, hierarchy, doc._class)
  const targets: Array<Ref<Doc>> = []
  if (collabSec?.provideSecurity === true) targets.push(doc._id)
  const attachedTo = (doc as Partial<AttachedDoc>).attachedTo
  if (collabSec?.provideAttachedSecurity === true && attachedTo != null) targets.push(attachedTo)
  return targets
}
