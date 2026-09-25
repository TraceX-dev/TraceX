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

import { AccountRole, type ModulePermissionGroup, type Permission, type Ref } from '../classes'
import { getRoleEffectivePermissions, isModulePermissionGranted } from '../modulePermissions'

const A = 'test:permission:A' as Ref<Permission>
const B = 'test:permission:B' as Ref<Permission>

function makeGroup (data: Partial<ModulePermissionGroup>): ModulePermissionGroup {
  return {
    _id: 'test:group' as Ref<ModulePermissionGroup>,
    _class: 'core:class:ModulePermissionGroup' as ModulePermissionGroup['_class'],
    space: 'core:space:Model' as ModulePermissionGroup['space'],
    modifiedOn: 0,
    modifiedBy: 'test' as ModulePermissionGroup['modifiedBy'],
    application: 'test:app' as ModulePermissionGroup['application'],
    role: AccountRole.Guest,
    permissions: [],
    enabled: true,
    ...data
  }
}

describe('module permissions', () => {
  it('merges groups of the same role and subtracts disabled permissions', () => {
    const result = getRoleEffectivePermissions([
      makeGroup({ permissions: [A, B], disabledPermissions: [B] }),
      makeGroup({ permissions: [B], role: AccountRole.DocGuest })
    ])
    expect(Array.from(result.get(AccountRole.Guest) ?? [])).toEqual([A])
    expect(Array.from(result.get(AccountRole.DocGuest) ?? [])).toEqual([B])
  })

  it('skips disabled groups', () => {
    const groups = [makeGroup({ permissions: [A], enabled: false })]
    expect(isModulePermissionGranted(groups, AccountRole.Guest, A)).toBe(false)
  })

  it('falls back to the legacy roles field', () => {
    const legacy = { ...makeGroup({ permissions: [A] }), role: undefined, roles: [AccountRole.DocGuest] }
    const groups = [legacy as unknown as ModulePermissionGroup]
    expect(isModulePermissionGranted(groups, AccountRole.DocGuest, A)).toBe(true)
    expect(isModulePermissionGranted(groups, AccountRole.Guest, A)).toBe(false)
  })
})
