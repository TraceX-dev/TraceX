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

import {
  AccountRole,
  hasAccountRole,
  isRowLevelRestricted,
  readOnlyGuestAccountUuid,
  type Account,
  type AccountUuid,
  type WorkspaceMemberInfo
} from '@hcengineering/core'

export const WORKSPACE_ROLES: AccountRole[] = [
  AccountRole.ReadOnlyGuest,
  AccountRole.Guest,
  AccountRole.User,
  AccountRole.Maintainer,
  AccountRole.Owner
]

interface SpaceMembership {
  members: AccountUuid[]
}

interface AccessibleSpaceMembership extends SpaceMembership {
  private?: boolean
}

export type MemberSpaceAvailability = 'member' | 'joinable'

export function getWorkspaceMemberRole (
  members: WorkspaceMemberInfo[],
  personUuid: AccountUuid
): AccountRole | undefined {
  return members.find((member) => member.person === personUuid)?.role
}

export function getAssignableWorkspaceRoles (account: Account, currentRole: AccountRole): AccountRole[] {
  return WORKSPACE_ROLES.filter((role) => role === currentRole || hasAccountRole(account, role))
}

export function canChangeWorkspaceRole (
  account: Account,
  target: AccountUuid,
  currentRole: AccountRole,
  members: WorkspaceMemberInfo[]
): boolean {
  if (target === readOnlyGuestAccountUuid || !hasAccountRole(account, currentRole)) return false
  if (account.uuid === target && !hasAccountRole(account, AccountRole.Owner)) return false

  const isLastOwner =
    currentRole === AccountRole.Owner && members.filter((member) => member.role === AccountRole.Owner).length === 1

  return !isLastOwner
}

export function canRevokeSpaceAccess (
  owners: AccountUuid[] | undefined,
  person: AccountUuid,
  hasWorkspaceOwnerAccess: boolean
): boolean {
  if (person === readOnlyGuestAccountUuid || owners?.includes(person) === true) {
    return hasWorkspaceOwnerAccess
  }

  return true
}

export function getSpacesForMember<T extends SpaceMembership> (spaces: T[], person: AccountUuid | undefined): T[] {
  if (person === undefined) return []
  return spaces.filter((space) => space.members.includes(person))
}

export function getMemberSpaceAvailability (
  space: AccessibleSpaceMembership,
  person: AccountUuid | undefined,
  role: AccountRole | undefined
): MemberSpaceAvailability | undefined {
  if (person === undefined || role === undefined) return undefined
  if (space.members.includes(person)) return 'member'
  if (space.private !== true && !isRowLevelRestricted(role)) return 'joinable'
  return undefined
}

export function getAvailableSpacesForMember<T extends AccessibleSpaceMembership> (
  spaces: T[],
  person: AccountUuid | undefined,
  role: AccountRole | undefined
): T[] {
  return spaces.filter((space) => getMemberSpaceAvailability(space, person, role) !== undefined)
}
