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
  type AccountRole,
  type Class,
  type ClassPermission,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type FindResult,
  type GuestAssigneePolicy,
  getGroupEffectivePermissions,
  getModulePermissionGroupRole,
  type MeasureContext,
  type ModulePermissionGroup,
  type Permission,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxApplyIf
} from '@hcengineering/core'

export interface GuestPermissionsCache {
  rolePolicies: Map<AccountRole, GuestClassPermissionPolicy[]>
}

export interface GuestClassPermissionPolicy {
  targetClass: Ref<Class<Doc>>
  spaceClass: Ref<Class<Space>> | undefined
  guestUpdateAttributes: Set<string> | undefined
  guestUpdateMixinAttributes: Map<string, Set<string>> | undefined
  guestCreateMixinAttributes: Map<string, Set<string>>
  relatedCreateClasses: Set<Ref<Class<Doc>>>
  sequenceNamespaces: Set<string>
  guestAssignee: GuestAssigneePolicy | undefined
}

export interface GuestTxScope {
  relatedCreates: Map<Ref<Space>, Set<Ref<Class<Doc>>>>
  createdTargets: Map<Ref<Doc>, { space: Ref<Space>, policies: GuestClassPermissionPolicy[] }>
  sequenceGuards: Set<string>
  spaceClasses: Map<Ref<Space>, Ref<Class<Space>> | undefined>
}

interface GuestPermissionsReader {
  findAll: <T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ) => Promise<FindResult<T>>
}

function toAttributeMap (value: Record<string, string[]> | undefined): Map<string, Set<string>> {
  return new Map(Object.entries(value ?? {}).map(([mixin, attributes]) => [mixin, new Set(attributes)]))
}

function toPolicy (permission: ClassPermission, spaceClass: Ref<Class<Space>> | undefined): GuestClassPermissionPolicy {
  return {
    targetClass: permission.targetClass,
    spaceClass,
    guestUpdateAttributes:
      permission.guestUpdateAttributes !== undefined ? new Set(permission.guestUpdateAttributes) : undefined,
    guestUpdateMixinAttributes:
      permission.guestUpdateMixinAttributes !== undefined || permission.guestCreateMixinAttributes !== undefined
        ? toAttributeMap(permission.guestUpdateMixinAttributes)
        : undefined,
    guestCreateMixinAttributes: toAttributeMap(permission.guestCreateMixinAttributes),
    relatedCreateClasses: new Set(permission.relatedCreateClasses ?? []),
    sequenceNamespaces: new Set(permission.sequenceNamespaces ?? []),
    guestAssignee: permission.guestAssignee
  }
}

export function emptyGuestPermissionsCache (): GuestPermissionsCache {
  return { rolePolicies: new Map() }
}

export function createGuestTxScope (): GuestTxScope {
  return { relatedCreates: new Map(), createdTargets: new Map(), sequenceGuards: new Set(), spaceClasses: new Map() }
}

export function getNestedTxes (tx: Tx): Tx[] {
  if (tx._class !== core.class.TxApplyIf) return [tx]
  return (tx as TxApplyIf).txes.flatMap(getNestedTxes)
}

export function sequenceGuardKey (namespace: string, scope: string, prefix: string): string {
  return JSON.stringify([namespace, scope, prefix])
}

export function getUpdatedAttributes (operations: Record<string, unknown>): Set<string> | undefined {
  const result = new Set<string>()
  const supportedOperators = new Set(['$push', '$pull', '$inc', '$unset', '$update'])
  for (const [key, value] of Object.entries(operations)) {
    if (!key.startsWith('$')) {
      result.add(key)
      continue
    }
    if (!supportedOperators.has(key) || value === null || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }
    for (const attribute of Object.keys(value)) result.add(attribute)
  }
  return result.size > 0 ? result : undefined
}

export async function loadGuestPermissionsCache (
  ctx: MeasureContext<SessionData>,
  reader: GuestPermissionsReader
): Promise<GuestPermissionsCache> {
  const groups = await reader.findAll(ctx, core.class.ModulePermissionGroup, {}, {})
  const activeGroups = groups.map((group: ModulePermissionGroup) => ({
    group,
    role: getModulePermissionGroupRole(group),
    permissions: getGroupEffectivePermissions(group)
  }))
  const allPermissionIds = new Set<Ref<Permission>>(activeGroups.flatMap((it) => it.permissions))
  if (allPermissionIds.size === 0) return emptyGuestPermissionsCache()

  const permissions = await reader.findAll(ctx, core.class.Permission, { _id: { $in: Array.from(allPermissionIds) } })
  const guestCreatePermissions = new Set(
    permissions.filter((permission) => permission.guestCreate === true).map((permission) => permission._id)
  )
  const classPermissions = await reader.findAll(ctx, core.class.ClassPermission, {
    _id: { $in: Array.from(allPermissionIds) as Array<Ref<ClassPermission>> }
  })
  const classPermissionsById = new Map<Ref<Permission>, ClassPermission>(
    classPermissions.map((permission) => [permission._id as Ref<Permission>, permission])
  )

  const createApplications = new Set<Ref<Doc>>()
  for (const { group, permissions } of activeGroups) {
    if (group.spaceClass !== undefined && permissions.some((it) => guestCreatePermissions.has(it))) {
      createApplications.add(group.application)
    }
  }
  const applicationPermissions =
    createApplications.size > 0
      ? await reader.findAll(ctx, core.class.ClassPermission, {
          application: { $in: Array.from(createApplications) }
        })
      : []

  const rolePolicies = new Map<AccountRole, GuestClassPermissionPolicy[]>()
  for (const { group, role, permissions } of activeGroups) {
    const policies = rolePolicies.get(role) ?? []
    for (const permissionId of permissions) {
      const permission = classPermissionsById.get(permissionId)
      if (permission?.targetClass !== undefined) policies.push(toPolicy(permission, undefined))
    }
    if (group.spaceClass !== undefined && permissions.some((it) => guestCreatePermissions.has(it))) {
      for (const permission of applicationPermissions) {
        if (permission.application !== group.application || permission.targetClass === undefined) continue
        policies.push(toPolicy(permission, group.spaceClass))
      }
    }
    rolePolicies.set(role, policies)
  }
  return { rolePolicies }
}
