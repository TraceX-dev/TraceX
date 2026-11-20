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
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import marketplace, { type CatalogPackage } from '@hcengineering/marketplace'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import ui, { Button, Dialog, EditBox, Label, Notice } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { getMarketplaceClient } from '../catalog'

  export let entry: CatalogPackage

  const dispatch = createEventDispatcher<{ close: boolean }>()
  const client = getMarketplaceClient()
  let ownerEmail = ''
  let busy = false
  let error = ''

  async function transfer (): Promise<void> {
    if (busy || ownerEmail.trim() === '') return
    busy = true
    error = ''
    try {
      await client.transferOwnership(entry, ownerEmail)
      dispatch('close', true)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  function close (): void {
    if (!busy) dispatch('close', false)
  }
</script>

<Dialog
  label={marketplace.string.TransferPackageOwnership}
  width="36rem"
  height="min(32rem, calc(100dvh - 2rem))"
  padding="var(--spacing-4)"
  scrollable
  on:close={close}
>
  <div class="flex-col flex-gap-4">
    <div class="package-name font-medium">{entry.name}</div>
    <div class="text-sm content-dark-color">
      <Label label={marketplace.string.TransferPackageOwnershipDescription} />
    </div>
    <div data-id="package-owner-email">
      <EditBox
        label={marketplace.string.AccountEmail}
        placeholder={marketplace.string.AccountEmail}
        bind:value={ownerEmail}
        disabled={busy}
        autoFocus
      />
    </div>
    {#if error}<div data-id="package-access-error"><Notice label={getEmbeddedLabel(error)} kind="error" /></div>{/if}
  </div>
  <svelte:fragment slot="footerRight">
    <Button label={ui.string.Cancel} disabled={busy} on:click={close} />
    <Button
      label={marketplace.string.TransferPackageOwnership}
      kind="negative"
      dataId="package-transfer-ownership"
      loading={busy}
      disabled={busy || ownerEmail.trim() === ''}
      on:click={transfer}
    />
  </svelte:fragment>
</Dialog>

<style lang="scss">
  .package-name {
    overflow-wrap: anywhere;
  }
</style>
