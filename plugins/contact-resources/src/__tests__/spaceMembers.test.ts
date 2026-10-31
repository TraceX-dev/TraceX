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

import type { AccountUuid, Space } from '@hcengineering/core'
import { getSpaceMembersUpdate } from '../spaceMembers'

const A = 'acc-a' as AccountUuid
const B = 'acc-b' as AccountUuid
const G = 'acc-g' as AccountUuid

function space (members: AccountUuid[], directMembers?: AccountUuid[]): Space {
  return { members, directMembers } as unknown as Space
}

describe('getSpaceMembersUpdate', () => {
  it('makes a member through a group a direct one', () => {
    // G is already a member through a group: members do not change, directMembers do.
    expect(getSpaceMembersUpdate(space([A, G], [A]), [A, G], [A, G])).toEqual({ directMembers: [A, G] })
  })

  it('writes only directMembers when the form edits them', () => {
    expect(getSpaceMembersUpdate(space([A, G], [A]), [A, B, G], [A, B])).toEqual({ directMembers: [A, B] })
  })

  it('is empty when direct members did not change', () => {
    expect(getSpaceMembersUpdate(space([A, G], [A]), [A, G], [A])).toEqual({})
  })

  it('compares with members of a space without directMembers', () => {
    expect(getSpaceMembersUpdate(space([A, B]), [A, B], [B, A])).toEqual({})
  })

  it('writes members when the form does not edit direct members', () => {
    expect(getSpaceMembersUpdate(space([A]), [A, B], undefined)).toEqual({ members: [A, B] })
    expect(getSpaceMembersUpdate(space([A, B]), [B, A], undefined)).toEqual({})
  })
})
