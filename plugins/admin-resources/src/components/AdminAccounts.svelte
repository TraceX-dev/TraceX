<!--
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
  import { type AccountAggregatedInfo } from '@hcengineering/account-client'
  import { type AccountUuid } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { MessageBox } from '@hcengineering/presentation'
  import { Button, CheckBox, IconDelete, Popup, Scroller, SearchEdit, showPopup } from '@hcengineering/ui'
  import { getAccountClient } from '@hcengineering/login-resources'
  import AdminAccountDetails from './AdminAccountDetails.svelte'
  import Table from './table/Table.svelte'

  interface AccountTableColumn {
    id: string
    label: import('@hcengineering/platform').IntlString
    getValue: (row: unknown) => string | number | boolean | null | undefined
    sortable?: boolean
  }

  interface AccountTableQuery {
    offset: number
    limit: number
    search: string
  }

  const accountClient = getAccountClient()
  let accountSuperAdminMode = false
  let search = ''
  let table: { refresh: () => void } | undefined = undefined

  const accountColumns: AccountTableColumn[] = [
    {
      id: 'name',
      label: getEmbeddedLabel('Name'),
      getValue: (row) => {
        const account = asAccount(row)
        return `${account.firstName} ${account.lastName}`
      }
    },
    {
      id: 'uuid',
      label: getEmbeddedLabel('Account ID'),
      getValue: (row) => asAccount(row).uuid
    },
    {
      id: 'socialIds',
      label: getEmbeddedLabel('Social IDs'),
      getValue: (row) => asAccount(row).socialIds.length
    },
    {
      id: 'workspaces',
      label: getEmbeddedLabel('Workspaces'),
      getValue: (row) => asAccount(row).workspaces.length
    },
    { id: 'actions', label: getEmbeddedLabel('Actions'), getValue: () => '' }
  ]

  const loadAccounts = async ({
    search,
    offset,
    limit
  }: AccountTableQuery): Promise<{ items: unknown[], hasNext: boolean }> => {
    const accounts = await accountClient.listAccounts(search, offset, limit)
    return { items: accounts, hasNext: accounts.length === limit }
  }

  async function deleteAccount (uuid: AccountUuid): Promise<void> {
    await accountClient.deleteAccount(uuid)
  }

  function openAccount (account: AccountAggregatedInfo): void {
    showPopup(AdminAccountDetails, { account }, 'top')
  }

  function asAccount (row: unknown): AccountAggregatedInfo {
    return row as AccountAggregatedInfo
  }
</script>

<Scroller>
  <div class="flex-column flex-grow p-5">
    <div class="flex-between">
      <div class="fs-title p-3">Accounts</div>
      <div class="flex-row-center">
        <span class="mr-4">Enable deletion</span>
        <CheckBox bind:checked={accountSuperAdminMode} />
      </div>
    </div>
    <div class="p-3 flex-no-shrink">
      <SearchEdit bind:value={search} width={'100%'} />
    </div>
    <div class="p-1 select-text-i">
      <Scroller maxHeight={40} noStretch={true}>
        <Table
          bind:this={table}
          bind:search
          columns={accountColumns}
          loader={loadAccounts}
          let:row
          let:column
          let:value
        >
          {@const account = asAccount(row)}
          {#if column.id === 'name'}
            <button
              class="account-link"
              on:click={() => {
                openAccount(account)
              }}>{value}</button
            >
          {:else if column.id === 'uuid'}
            <span class="account-id select-text-i">{value}</span>
          {:else if column.id === 'socialIds' || column.id === 'workspaces'}
            <button
              class="account-link"
              on:click={() => {
                openAccount(account)
              }}>{value}</button
            >
          {:else if column.id === 'actions' && accountSuperAdminMode}
            <Button
              icon={IconDelete}
              size={'small'}
              kind={'dangerous'}
              label={getEmbeddedLabel('Delete')}
              on:click={() => {
                showPopup(MessageBox, {
                  label: getEmbeddedLabel(`Delete account ${account.firstName} ${account.lastName}`),
                  message: getEmbeddedLabel('Please confirm account deletion. This action cannot be undone.'),
                  action: async () => {
                    await deleteAccount(account.uuid)
                    table?.refresh()
                  }
                })
              }}
            />
          {:else}
            {value ?? ''}
          {/if}
        </Table>
      </Scroller>
    </div>
  </div>
</Scroller>
<Popup />

<style lang="scss">
  .account-link {
    padding: 0;
    border: 0;
    color: inherit;
    background: transparent;
    cursor: pointer;
    font: inherit;
    text-align: left;

    &:hover {
      color: var(--theme-link-color);
      text-decoration: underline;
    }
  }
</style>
