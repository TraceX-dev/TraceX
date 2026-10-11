<!--
// Copyright © 2020 Anticrm Platform Contributors.
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
  import { getMetadata } from '@hcengineering/platform'
  import { upgradeDownloadProgress } from '@hcengineering/presentation'
  import { Button, Component, Label, LoadingScreen, Notifications, location } from '@hcengineering/ui'
  import { connect, disconnect, error, errorActions } from '../connect'

  import workbench, { workbenchId } from '@hcengineering/workbench'
  import { onDestroy } from 'svelte'
  import workbenchRes from '../plugin'
  import { workspaceCreating } from '../utils'

  const isNeedUpgrade = window.location.host === ''

  onDestroy(disconnect)
</script>

{#if $location.path[0] === workbenchId || $location.path[0] === workbenchRes.component.WorkbenchApp}
  {#key $location.path[1]}
    {#await connect(getMetadata(workbenchRes.metadata.PlatformTitle) ?? 'Platform')}
      <LoadingScreen
        caption={($workspaceCreating ?? -1) >= 0 ? workbenchRes.string.WorkspaceCreating : undefined}
        progress={($workspaceCreating ?? -1) >= 0
          ? $workspaceCreating
          : $upgradeDownloadProgress >= 0
            ? $upgradeDownloadProgress
            : undefined}
      >
        {#if $upgradeDownloadProgress >= 0}
          <div>
            <Label label={workbench.string.UpgradeDownloadProgress} params={{ percent: $upgradeDownloadProgress }} />
          </div>
        {/if}
        {#if $error}
          <div class="error-text">
            {$error}
          </div>
        {/if}
        <svelte:fragment slot="actions">
          {#if $error && $errorActions.length > 0}
            {#each $errorActions as action}
              <Button label={action.label} on:click={action.action} />
            {/each}
          {/if}
        </svelte:fragment>
      </LoadingScreen>
    {:then client}
      {#if $error}
        <div class="version-wrapper">
          <div class="antiPopup version-popup">
            {#if isNeedUpgrade}
              <h1><Label label={workbenchRes.string.NewVersionAvailable} /></h1>
              <span class="please-update"><Label label={workbenchRes.string.PleaseUpdate} /></span>
            {:else}
              <h1><Label label={workbenchRes.string.ServerUnderMaintenance} /></h1>
            {/if}
            {$error}
            {#if $upgradeDownloadProgress >= 0}
              <div class="mt-1">
                <Label
                  label={workbench.string.UpgradeDownloadProgress}
                  params={{ percent: $upgradeDownloadProgress }}
                />
              </div>
            {/if}
          </div>
        </div>
      {:else if client}
        <Notifications>
          <Component is={workbenchRes.component.Workbench} />
        </Notifications>
      {/if}
    {:catch error}
      <div>{error} -- {error.stack}</div>
    {/await}
  {/key}
{/if}

<style lang="scss">
  .version-wrapper {
    height: 100%;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .error-text {
    color: var(--theme-warning-color);
  }
  .please-update {
    margin-bottom: 1rem;
  }
  .version-popup {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    flex-grow: 1;
  }
</style>
