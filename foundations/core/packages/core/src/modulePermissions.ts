/**

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { AccountRole, type ModulePermissionGroup, type Permission, type Ref } from './classes'

/**
 * Legacy groups may carry a `roles` array instead of a single `role`.
 */
interface LegacyModulePermissionGroup {
  roles?: AccountRole[]
}

/**
 * Returns the role a module permission group applies to.
 * Falls back to the legacy `roles` field and then to {@link AccountRole.Guest}.
 *
 * @public
 */
export function getModulePermissionGroupRole (group: ModulePermissionGroup): AccountRole {
  const legacyRoles = (group as ModulePermissionGroup & LegacyModulePermissionGroup).roles
  return group.role ?? (Array.isArray(legacyRoles) && legacyRoles.length > 0 ? legacyRoles[0] : AccountRole.Guest)
}

/**
 * Returns the permissions a module permission group effectively grants: nothing when the group is disabled,
 * otherwise `permissions` without `disabledPermissions`.
 *
 * @public
 */
export function getGroupEffectivePermissions (group: ModulePermissionGroup): Array<Ref<Permission>> {
  // Stored groups may lack `enabled`: only an explicit false disables a group.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
  if (group.enabled === false) return []
  const disabled = new Set<Ref<Permission>>(group.disabledPermissions ?? [])
  return (group.permissions ?? []).filter((permission) => !disabled.has(permission))
}

/**
 * Computes the effective permissions granted to every role by module permission groups.
 * Server and client must use these helpers so that they never diverge.
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
 * Checks whether the permission is effectively granted to the role by module permission groups.
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
