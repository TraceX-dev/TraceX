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

import { AccountRole, type ModulePermissionGroup, type Permission, type Ref } from './classes'

interface LegacyModulePermissionGroup {
  roles?: AccountRole[]
}

/**
 * Returns the group's role, including the legacy `roles` fallback.
 *
 * @public
 */
export function getModulePermissionGroupRole (group: ModulePermissionGroup): AccountRole {
  const legacyRoles = (group as ModulePermissionGroup & LegacyModulePermissionGroup).roles
  return group.role ?? (Array.isArray(legacyRoles) && legacyRoles.length > 0 ? legacyRoles[0] : AccountRole.Guest)
}

/**
 * Returns the permissions granted by an enabled group.
 *
 * @public
 */
export function getGroupEffectivePermissions (group: ModulePermissionGroup): Array<Ref<Permission>> {
  // Legacy records may omit `enabled`.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
  if (group.enabled === false) return []
  const disabled = new Set<Ref<Permission>>(group.disabledPermissions ?? [])
  return (group.permissions ?? []).filter((permission) => !disabled.has(permission))
}

/**
 * Groups effective permissions by role.
 *
 * @public
 */
export function getRoleEffectivePermissions (groups: ModulePermissionGroup[]): Map<AccountRole, Set<Ref<Permission>>> {
  const result = new Map<AccountRole, Set<Ref<Permission>>>()
  for (const group of groups) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
    if (group.enabled === false) continue
    const role = getModulePermissionGroupRole(group)
    const current = result.get(role) ?? new Set<Ref<Permission>>()
    for (const permission of getGroupEffectivePermissions(group)) current.add(permission)
    result.set(role, current)
  }
  return result
}

/**
 * Checks whether a role has an effective permission.
 *
 * @public
 */
export function isModulePermissionGranted (
  groups: ModulePermissionGroup[],
  role: AccountRole,
  permission: Ref<Permission>
): boolean {
  return getRoleEffectivePermissions(groups).get(role)?.has(permission) ?? false
}
