<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import platform, { getMetadata, Severity, Status as PlatformStatus } from '@hcengineering/platform'
  import { Label, Loading, Notifications, Status, location } from '@hcengineering/ui'
  import { upgradeDownloadProgress } from '@hcengineering/presentation'
  import { disconnectEmbeddedWorkspace } from '@hcengineering/workbench-resources'
  import { Analytics } from '@hcengineering/analytics'
  import { onDestroy } from 'svelte'
  import { connect, versionError, invalidError, connectionError } from '../connect'

  import { guestId } from '@hcengineering/guest'
  import workbench from '@hcengineering/workbench'
  import Guest from './Guest.svelte'
  import GuestLinkRevoked from './GuestLinkRevoked.svelte'
  const connectionStatus = new PlatformStatus(Severity.ERROR, platform.status.ConnectionClosed, {})
  $: connection =
    $location.path[0] === guestId
      ? connect(getMetadata(workbench.metadata.PlatformTitle) ?? 'Platform')
      : Promise.resolve(undefined)
  onDestroy(() => {
    void disconnectEmbeddedWorkspace().catch(Analytics.handleError)
  })
</script>

{#if $location.path[0] === guestId}
  {#if $versionError}
    <div class="version-wrapper">
      <div class="antiPopup version-popup">
        <h1><Label label={workbench.string.ServerUnderMaintenance} /></h1>
        {$versionError}
        {#if $upgradeDownloadProgress >= 0}
          <div class="mt-1">
            <Label label={workbench.string.UpgradeDownloadProgress} params={{ percent: $upgradeDownloadProgress }} />
          </div>
        {/if}
      </div>
    </div>
  {:else if $invalidError}
    <GuestLinkRevoked />
  {:else if $connectionError}
    <div class="version-wrapper">
      <div class="antiPopup version-popup" data-id="guest-connection-error">
        <Status status={connectionStatus} />
      </div>
    </div>
  {:else}
    {#await connection}
      <Loading />
    {:then client}
      {#if client}
        <Notifications>
          <Guest />
        </Notifications>
      {/if}
    {:catch}
      <div class="version-wrapper">
        <div class="antiPopup version-popup" data-id="guest-connection-error">
          <Status status={connectionStatus} />
        </div>
      </div>
    {/await}
  {/if}
{/if}

<style lang="scss">
  .version-wrapper {
    height: 100%;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .version-popup {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    flex-grow: 1;
  }
</style>
