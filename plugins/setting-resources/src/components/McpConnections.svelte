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
  import login from '@hcengineering/login'
  import { getClient as getOpenAuthClient, type PublicConnection } from '@hcengineering/openauth-client'
  import { getMetadata, setPlatformStatus, unknownError } from '@hcengineering/platform'
  import presentation, { MessageBox } from '@hcengineering/presentation'
  import { themeStore } from '@hcengineering/theme'
  import { Button, Icon, IconLink, Label, Loading, SettingsCard, showPopup } from '@hcengineering/ui'
  import setting from '../plugin'

  const issuerUrl = getMetadata(login.metadata.OAuthURL)?.replace(/\/$/, '')
  const client = issuerUrl === undefined || issuerUrl === '' ? undefined : getOpenAuthClient(issuerUrl)
  let connections: PublicConnection[] = []
  let loading = true
  let failed = false

  function formatConnectedDate (value: number, language: string): string {
    const date = new Date(value)
    const options: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
    }
    return date.toLocaleDateString(language, options)
  }

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
        <ul class="connections-list">
          {#each connections as connection (connection.id)}
            <li class="connection-row" data-id="mcp-connection">
              <div class="connection-icon flex-center"><Icon icon={IconLink} size="small" /></div>
              <div class="flex-col flex-gap-1">
                <div class="flex-row-center flex-wrap flex-gap-2">
                  <span class="font-semi-bold overflow-label">{connection.clientName}</span>
                  <span class="connection-kind text-sm content-dark-color">MCP</span>
                </div>
                <div class="flex-row-center flex-wrap flex-gap-1 text-md content-dark-color">
                  <span class="connection-scope">
                    {#if connection.workspaceId === null}
                      <Label label={login.string.AllAvailableWorkspaces} />
                    {:else}
                      {connection.workspaceName ?? connection.workspaceId}
                      {#if connection.workspaceUrl}
                        ({connection.workspaceUrl}){/if}
                    {/if}
                  </span>
                  <span>·</span>
                  <span>
                    <Label label={setting.string.Connected} />{' '}
                    <time
                      class="no-word-wrap"
                      datetime={new Date(connection.createdOn).toISOString()}
                      title={new Date(connection.createdOn).toLocaleString($themeStore.language)}
                      >{formatConnectedDate(connection.createdOn, $themeStore.language)}</time
                    >
                  </span>
                </div>
              </div>
              <Button
                label={setting.string.Disconnect}
                dataId="mcp-disconnect"
                on:click={() => {
                  disconnect(connection)
                }}
              />
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </SettingsCard>
{/if}

<style lang="scss">
  .connections-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .connection-row {
    display: grid;
    grid-template-columns: 2.25rem minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--spacing-1_5);
    padding: var(--spacing-1_5) 0;

    & + .connection-row {
      border-top: 1px solid var(--theme-divider-color);
    }

    &:first-child {
      padding-top: 0;
    }

    &:last-child {
      padding-bottom: 0;
    }
  }

  .connection-icon {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    color: var(--primary-button-color);
    background-color: var(--primary-button-default);
  }

  .connection-kind {
    padding: var(--spacing-0_25) var(--spacing-0_75);
    border-radius: var(--spacing-0_5);
    background-color: var(--theme-button-hovered);
    line-height: 1.25;
  }

  .connection-scope {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
