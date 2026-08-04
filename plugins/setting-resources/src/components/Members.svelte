<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
-->
<script lang="ts">
  import contact, { Employee, formatName } from '@hcengineering/contact'
  import { EmployeePresenter } from '@hcengineering/contact-resources'
  import { type WorkspaceMemberInfo, AccountRole, getCurrentAccount, isGuestRole } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Breadcrumb, Header, Scroller, SearchInput } from '@hcengineering/ui'
  import { onMount } from 'svelte'

  import setting from '../plugin'
  import { canChangeWorkspaceRole, getAssignableWorkspaceRoles, getWorkspaceMemberRole } from '../accessPermissions'
  import { getAccountClient } from '../utils'
  import UserRoleSelect from './UserRoleSelect.svelte'
  import { Analytics } from '@hcengineering/analytics'

  const query = createQuery()
  const currentAccount = getCurrentAccount()
  const client = getClient()

  const accountClient = getAccountClient()
  let workspaceMembers: WorkspaceMemberInfo[] = []
  let employees: Employee[] = []

  onMount(async () => {
    workspaceMembers = await accountClient.getWorkspaceMembers()
  })

  query.query(contact.mixin.Employee, { active: true }, (res) => {
    employees = res
      .filter((e) => e.personUuid != null)
      .sort((a, b) => formatName(a.name).localeCompare(formatName(b.name)))
  })

  async function change (personUuid: string, value: AccountRole): Promise<void> {
    if (accountClient == null) {
      return
    }

    try {
      await accountClient.updateWorkspaceRole(personUuid, value)
      workspaceMembers = workspaceMembers.map((member) =>
        member.person === personUuid ? { ...member, role: value } : member
      )

      const employee = employees.find((e) => e.personUuid === personUuid)
      if (employee !== undefined) {
        const employeeRole = isGuestRole(value) ? 'GUEST' : 'USER'
        await client.update(employee, { role: employeeRole })
      }
    } catch (e: any) {
      Analytics.handleError(e)
    }
  }
  let search = ''
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={setting.icon.Members} label={setting.string.Members} size={'large'} isCurrent />
    <svelte:fragment slot="search">
      <SearchInput bind:value={search} collapsed />
    </svelte:fragment>
  </Header>
  <div class="hulyComponent-content__column content">
    <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
      <div class="hulyComponent-content">
        {#each employees as employee (employee._id)}
          {@const personUuid = employee.personUuid ?? undefined}
          {@const role = personUuid !== undefined ? getWorkspaceMemberRole(workspaceMembers, personUuid) : undefined}
          {#if personUuid !== undefined && role !== undefined && employee.name?.includes(search)}
            <div class="flex-row-center p-2 flex-no-shrink" data-id="owners-member-row">
              <div class="p-1 min-w-80">
                <EmployeePresenter value={employee} disabled={false} />
              </div>
              <UserRoleSelect
                disabled={!canChangeWorkspaceRole(currentAccount, personUuid, role, workspaceMembers)}
                kind={'primary'}
                size={'medium'}
                roles={getAssignableWorkspaceRoles(currentAccount, role)}
                securityFilter={false}
                selected={role}
                on:selected={(e) => {
                  void change(personUuid, e.detail)
                }}
              />
            </div>
          {/if}
        {/each}
      </div>
    </Scroller>
  </div>
</div>
