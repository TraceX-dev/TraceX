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

import core, {
  type Class,
  type ClassPermission,
  type Doc,
  GuestSecurityProfile,
  type ModulePermissionGroup,
  type Permission,
  type Ref
} from '@hcengineering/core'
import { getDisabledPermissionsForProfile, resolveSecurityProfile } from '../guestSecurityProfiles'

const CREATE = 'test:permission:Create' as Ref<Permission>
const COLLABORATORS = 'test:permission:Collaborators' as Ref<Permission>
const PROCESS = 'test:permission:Process' as Ref<Permission>

const permissions = new Map<Ref<Permission>, Permission>([
  [CREATE, { _id: CREATE, targetClass: 'card:class:Card' as Ref<Class<Doc>> } as unknown as ClassPermission],
  [
    COLLABORATORS,
    { _id: COLLABORATORS, targetClass: core.class.Collaborator } as unknown as ClassPermission
  ],
  [
    PROCESS,
    { _id: PROCESS, targetClass: 'process:class:ApproveRequest' as Ref<Class<Doc>> } as unknown as ClassPermission
  ]
])

function group (disabledPermissions: Array<Ref<Permission>>, enabled = true): ModulePermissionGroup {
  return {
    enabled,
    permissions: [CREATE, COLLABORATORS, PROCESS],
    disabledPermissions
  } as unknown as ModulePermissionGroup
}

describe('guest security profiles', () => {
  it('recognizes the three presets', () => {
    expect(resolveSecurityProfile([group([CREATE, COLLABORATORS, PROCESS])], permissions)).toBe(
      GuestSecurityProfile.Viewer
    )
    expect(resolveSecurityProfile([group([COLLABORATORS, PROCESS])], permissions)).toBe(
      GuestSecurityProfile.Participant
    )
    expect(resolveSecurityProfile([group([])], permissions)).toBe(GuestSecurityProfile.Advanced)
  })

  it('marks disabled modules and mixed permissions as custom', () => {
    expect(resolveSecurityProfile([group([], false)], permissions)).toBe(GuestSecurityProfile.Custom)
    expect(resolveSecurityProfile([group([CREATE])], permissions)).toBe(GuestSecurityProfile.Custom)
  })

  it('keeps collaborator and process actions out of the participant profile', () => {
    expect(getDisabledPermissionsForProfile(group([]), GuestSecurityProfile.Participant, permissions)).toEqual([
      COLLABORATORS,
      PROCESS
    ])
  })
})
