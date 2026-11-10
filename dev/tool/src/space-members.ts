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

import core, { type AccountUuid, type Ref, type Space, type TxOperations, type UserGroup } from '@hcengineering/core'

export interface SpaceMembersDrift {
  space: Ref<Space>
  spaceClass: string
  spaceName: string
  /** `directMembers` is not set: the space was created after the migration by code that did not set it. */
  notMigrated: boolean
  /** In `members`, but neither direct nor given by a group: written by code that bypasses directMembers. */
  stray: AccountUuid[]
  /** Given directly or by a group, but not in `members`: a recompute was missed. */
  missing: AccountUuid[]
}

export interface RecomputeSpaceMembersResult {
  drift: SpaceMembersDrift[]
  fixed: number
}

/**
 * Checks `Space.members == unique(directMembers ∪ members of groups)` for every space.
 *
 * Fixing never takes access away: stray members become direct members, and the write of `directMembers` makes the
 * server recompute `members`, which adds the missing ones.
 */
export async function recomputeSpaceMembers (ops: TxOperations, dryRun: boolean): Promise<RecomputeSpaceMembersResult> {
  const groups = new Map<Ref<UserGroup>, UserGroup>()
  for (const group of await ops.findAll(core.class.UserGroup, {})) {
    groups.set(group._id, group)
  }

  const result: RecomputeSpaceMembersResult = { drift: [], fixed: 0 }
  for (const space of await ops.findAll(core.class.Space, {})) {
    const members = space.members ?? []
    const direct = space.directMembers ?? members
    const byGroups = new Set<AccountUuid>()
    for (const groupId of space.groups ?? []) {
      for (const member of groups.get(groupId)?.members ?? []) byGroups.add(member)
    }
    const target = new Set<AccountUuid>([...direct, ...byGroups])
    const stray = Array.from(new Set(members)).filter((it) => !target.has(it))
    const missing = Array.from(target).filter((it) => !members.includes(it))
    const notMigrated = space.directMembers === undefined
    if (!notMigrated && stray.length === 0 && missing.length === 0) continue

    const drift: SpaceMembersDrift = {
      space: space._id,
      spaceClass: space._class,
      spaceName: space.name,
      notMigrated,
      stray,
      missing
    }
    result.drift.push(drift)

    if (dryRun) {
      console.log('[dry-run] space members drift', JSON.stringify(drift))
      continue
    }
    await ops.update(space, { directMembers: Array.from(new Set([...direct, ...stray])) })
    result.fixed++
  }
  return result
}
