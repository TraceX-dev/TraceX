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

import core, {
  type AccountUuid,
  readOnlyGuestAccountUuid,
  type Ref,
  type Space,
  type UserGroup
} from '@hcengineering/core'
import { getSpacesLeftWithoutMembers } from '../spaceAccessUtils'

const A = 'acc-a' as AccountUuid
const B = 'acc-b' as AccountUuid
const G1 = 'group-1' as Ref<UserGroup>
const G2 = 'group-2' as Ref<UserGroup>

function group (_id: Ref<UserGroup>, members: AccountUuid[]): UserGroup {
  const value: UserGroup = {
    _id,
    _class: core.class.UserGroup,
    space: core.space.Workspace,
    modifiedOn: 0,
    modifiedBy: core.account.System,
    name: _id,
    members
  }
  return value
}

function space (
  name: string,
  members: AccountUuid[],
  directMembers: AccountUuid[] | undefined,
  groups: Array<Ref<UserGroup>>,
  isPrivate = true
): Space {
  const value: Space = {
    _id: name as Ref<Space>,
    _class: core.class.Space,
    space: core.space.Space,
    modifiedOn: 0,
    modifiedBy: core.account.System,
    name,
    description: '',
    members,
    directMembers,
    groups,
    private: isPrivate,
    archived: false
  }
  return value
}

describe('getSpacesLeftWithoutMembers', () => {
  const groups = [group(G1, [A, B]), group(G2, [B])]

  it('finds a private space whose only members come from a removed group', () => {
    const onlyGroup = space('only-group', [A, B], [], [G1])
    const withDirect = space('with-direct', [A, B], [A], [G1])
    const otherGroup = space('other-group', [A, B], [], [G1, G2])
    const result = getSpacesLeftWithoutMembers([onlyGroup, withDirect, otherGroup], {
      groups: groups.filter((it) => it._id !== G1)
    })
    expect(result.map((it) => it.name)).toEqual(['only-group'])
  })

  it('ignores public spaces and spaces that have no members already', () => {
    const publicSpace = space('public', [A, B], [], [G1], false)
    const empty = space('empty', [], [], [])
    const result = getSpacesLeftWithoutMembers([publicSpace, empty], { groups: [] })
    expect(result).toEqual([])
  })

  it('checks a change of group members and of bindings', () => {
    const onlyGroup = space('only-group', [A, B], [], [G1])
    expect(
      getSpacesLeftWithoutMembers([onlyGroup], { groups: [group(G1, []), group(G2, [B])] }).map((it) => it.name)
    ).toEqual(['only-group'])
    expect(getSpacesLeftWithoutMembers([onlyGroup], { groups, bindings: new Map([[onlyGroup._id, [G2]]]) })).toEqual([])
    expect(
      getSpacesLeftWithoutMembers([onlyGroup], { groups, bindings: new Map([[onlyGroup._id, []]]) }).map(
        (it) => it.name
      )
    ).toEqual(['only-group'])
  })

  it('does not count the anonymous guest as a member', () => {
    const anonymous = space('anonymous', [readOnlyGuestAccountUuid, A], [readOnlyGuestAccountUuid], [G1])
    const result = getSpacesLeftWithoutMembers([anonymous], { groups: [] })
    expect(result.map((it) => it.name)).toEqual(['anonymous'])
  })
})
