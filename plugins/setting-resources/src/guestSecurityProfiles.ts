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

export type SecurityProfile = GuestSecurityProfile

const APPROVE_REQUEST_CLASS = 'process:class:ApproveRequest' as Ref<Class<Doc>>

export function isAdvancedGuestPermission (
  permissionId: Ref<Permission>,
  permissions: Map<Ref<Permission>, Permission>
): boolean {
  const permission = permissions.get(permissionId) as ClassPermission | undefined
  return permission?.targetClass === core.class.Collaborator || permission?.targetClass === APPROVE_REQUEST_CLASS
}

export function resolveSecurityProfile (
  groups: ModulePermissionGroup[],
  permissions: Map<Ref<Permission>, Permission>
): SecurityProfile {
  if (groups.some((group) => !group.enabled)) return GuestSecurityProfile.Custom

  const states = groups.flatMap((group) => {
    const disabled = new Set(group.disabledPermissions ?? [])
    return (group.permissions ?? []).map((permissionId) => ({
      permissionId,
      active: !disabled.has(permissionId)
    }))
  })

  if (states.every(({ active }) => !active)) return GuestSecurityProfile.Viewer
  if (states.every(({ active }) => active)) return GuestSecurityProfile.Advanced

  const participantMatches = states.every(
    ({ permissionId, active }) => active !== isAdvancedGuestPermission(permissionId, permissions)
  )
  return participantMatches ? GuestSecurityProfile.Participant : GuestSecurityProfile.Custom
}

export function getDisabledPermissionsForProfile (
  group: ModulePermissionGroup,
  profile: Exclude<SecurityProfile, GuestSecurityProfile.Custom>,
  permissions: Map<Ref<Permission>, Permission>
): Array<Ref<Permission>> {
  if (profile === GuestSecurityProfile.Viewer) return [...(group.permissions ?? [])]
  if (profile === GuestSecurityProfile.Participant) {
    return (group.permissions ?? []).filter((permissionId) => isAdvancedGuestPermission(permissionId, permissions))
  }
  return []
}
