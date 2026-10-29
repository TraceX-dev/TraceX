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
  import { onMount } from 'svelte'
  import { DateRangeMode } from '@hcengineering/core'
  import login from '@hcengineering/login'
  import { getClient as getOpenAuthClient, type PublicConnection } from '@hcengineering/openauth-client'
  import { getMetadata, setPlatformStatus, unknownError } from '@hcengineering/platform'
  import presentation, { MessageBox } from '@hcengineering/presentation'
  import { Button, DatePresenter, IconDelete, Label, Loading, SettingsCard, showPopup } from '@hcengineering/ui'
  import setting from '../plugin'

  const issuerUrl = getMetadata(login.metadata.OAuthURL)?.replace(/\/$/, '')
  const client = issuerUrl === undefined || issuerUrl === '' ? undefined : getOpenAuthClient(issuerUrl)
  let connections: PublicConnection[] = []
  let loading = true
  let failed = false

  async function load (): Promise<void> {
    if (client === undefined) return
    loading = true
    failed = false
    try {
      const token = getMetadata(presentation.metadata.Token)
      connections = await client.getConnections(token)
    } catch {
      failed = true
    } finally {
      loading = false
    }
  }

  function disconnect (connection: PublicConnection): void {
    showPopup(MessageBox, {
      label: setting.string.Disconnect,
      message: login.string.DisconnectApplicationConfirm,
      params: { name: connection.clientName },
      dangerous: true,
      action: async () => {
        if (client === undefined) return
        try {
          const token = getMetadata(presentation.metadata.Token)
          await client.revokeConnection(connection.id, token)
          await load()
        } catch (error: unknown) {
          await setPlatformStatus(unknownError(error))
        }
      }
    })
  }

  onMount(() => {
    if (issuerUrl !== undefined && issuerUrl !== '') void load()
  })
</script>

{#if issuerUrl !== undefined && issuerUrl !== ''}
  <SettingsCard label={login.string.McpConnections}>
    <div class="flex-col flex-gap-4" data-id="mcp-connections">
      {#if loading}
        <Loading />
      {:else if failed}
        <Label label={setting.string.FailedToLoadIntegrations} />
        <Button
          label={setting.string.Proceed}
          on:click={() => {
            void load()
          }}
        />
      {:else if connections.length === 0}
        <Label label={login.string.NoMcpConnections} />
      {:else}
        <table class="connections-list">
          <tbody>
            {#each connections as connection (connection.id)}
              <tr data-id="mcp-connection">
                <th scope="row" class="font-semi-bold">{connection.clientName}</th>
                <td>
                  <DatePresenter
                    value={connection.createdOn}
                    kind="ghost"
                    mode={DateRangeMode.DATETIME}
                    showIcon={false}
                  />
                </td>
                <td>
                  <Button
                    icon={IconDelete}
                    kind="icon"
                    size="small"
                    showTooltip={{ label: setting.string.Disconnect }}
                    dataId="mcp-disconnect"
                    on:click={() => {
                      disconnect(connection)
                    }}
                  />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </SettingsCard>
{/if}

<style lang="scss">
  .connections-list {
    width: 100%;
    border-collapse: collapse;

    th,
    td {
      padding: var(--spacing-1_25) 0;
      vertical-align: middle;
    }

    tr + tr {
      border-top: 1px solid var(--theme-divider-color);
    }

    th {
      width: 100%;
      text-align: left;
      overflow-wrap: anywhere;
    }

    td {
      padding-left: var(--spacing-2);
      white-space: nowrap;
    }
  }
</style>
