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
  readOnlyGuestAccountUuid,
  type Account,
  type AccountUuid,
  type PersonId,
  type WorkspaceMemberInfo
} from '@hcengineering/core'

import {
  canChangeWorkspaceRole,
  canRevokeSpaceAccess,
  getAvailableSpacesForMember,
  getAssignableWorkspaceRoles,
  getMemberSpaceAvailability,
  getSpacesForMember
} from '../accessPermissions'

const OWNER = 'owner' as AccountUuid
const SECOND_OWNER = 'second-owner' as AccountUuid
const USER = 'user' as AccountUuid
const ANONYMOUS = readOnlyGuestAccountUuid

function account (uuid: AccountUuid, role: AccountRole): Account {
  return {
    uuid,
    role,
    primarySocialId: '' as PersonId,
    socialIds: [],
    fullSocialIds: []
  }
}

function member (person: AccountUuid, role: AccountRole): WorkspaceMemberInfo {
  return { person, role }
}

describe('access permissions', () => {
  it('does not allow changing the last owner or the current non-owner account', () => {
    const currentAccount = account(OWNER, AccountRole.Owner)
    const members = [member(OWNER, AccountRole.Owner), member(USER, AccountRole.User)]

    expect(canChangeWorkspaceRole(currentAccount, OWNER, AccountRole.Owner, members)).toBe(false)
    expect(canChangeWorkspaceRole(currentAccount, USER, AccountRole.User, members)).toBe(true)
    expect(canChangeWorkspaceRole(account(USER, AccountRole.User), USER, AccountRole.User, members)).toBe(false)
    expect(canChangeWorkspaceRole(account(USER, AccountRole.Maintainer), OWNER, AccountRole.Owner, members)).toBe(false)
  })

  it('allows an owner to change their own role when another owner remains', () => {
    const members = [member(OWNER, AccountRole.Owner), member(SECOND_OWNER, AccountRole.Owner)]

    expect(canChangeWorkspaceRole(account(OWNER, AccountRole.Owner), OWNER, AccountRole.Owner, members)).toBe(true)
  })

  it('does not allow changing the anonymous guest role', () => {
    const members = [member(OWNER, AccountRole.Owner), member(ANONYMOUS, AccountRole.ReadOnlyGuest)]

    expect(
      canChangeWorkspaceRole(account(OWNER, AccountRole.Owner), ANONYMOUS, AccountRole.ReadOnlyGuest, members)
    ).toBe(false)
  })

  it('only exposes roles assignable by the current account and preserves the current role', () => {
    expect(getAssignableWorkspaceRoles(account(USER, AccountRole.Maintainer), AccountRole.Owner)).toEqual([
      AccountRole.ReadOnlyGuest,
      AccountRole.Guest,
      AccountRole.User,
      AccountRole.Maintainer,
      AccountRole.Owner
    ])
    expect(getAssignableWorkspaceRoles(account(USER, AccountRole.User), AccountRole.Maintainer)).toEqual([
      AccountRole.ReadOnlyGuest,
      AccountRole.Guest,
      AccountRole.User,
      AccountRole.Maintainer
    ])
  })

  it('only allows workspace owners to revoke protected space access', () => {
    expect(canRevokeSpaceAccess([OWNER], OWNER, false)).toBe(false)
    expect(canRevokeSpaceAccess([OWNER], OWNER, true)).toBe(true)
    expect(canRevokeSpaceAccess([], ANONYMOUS, false)).toBe(false)
    expect(canRevokeSpaceAccess([], ANONYMOUS, true)).toBe(true)
    expect(canRevokeSpaceAccess([], USER, false)).toBe(true)
  })

  it('returns only spaces containing the selected member', () => {
    const spaces = [
      { id: 'one', members: [USER] },
      { id: 'two', members: [OWNER, USER] },
      { id: 'three', members: [OWNER] }
    ]

    expect(getSpacesForMember(spaces, USER)).toEqual(spaces.slice(0, 2))
    expect(getSpacesForMember(spaces, undefined)).toEqual([])
  })

  it('distinguishes memberships from public spaces a user can join', () => {
    const memberSpace = { id: 'member', members: [USER], private: true }
    const publicSpace = { id: 'public', members: [OWNER], private: false }
    const privateSpace = { id: 'private', members: [OWNER], private: true }

    expect(getMemberSpaceAvailability(memberSpace, USER, AccountRole.User)).toBe('member')
    expect(getMemberSpaceAvailability(publicSpace, USER, AccountRole.User)).toBe('joinable')
    expect(getMemberSpaceAvailability(privateSpace, USER, AccountRole.User)).toBeUndefined()
    expect(getAvailableSpacesForMember([memberSpace, publicSpace, privateSpace], USER, AccountRole.User)).toEqual([
      memberSpace,
      publicSpace
    ])
  })

  it('does not offer non-member spaces to guests', () => {
    const publicSpace = { id: 'public', members: [OWNER], private: false }

    expect(getMemberSpaceAvailability(publicSpace, USER, AccountRole.Guest)).toBeUndefined()
    expect(getMemberSpaceAvailability(publicSpace, USER, AccountRole.ReadOnlyGuest)).toBeUndefined()
  })
})
