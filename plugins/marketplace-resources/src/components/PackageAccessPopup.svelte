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
  import marketplace, { type CatalogPackage, type CatalogPackageReader } from '@hcengineering/marketplace'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import ui, { Button, Dialog, EditBox, Label, Notice, Spinner, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { getMarketplaceClient } from '../catalog'
  import PackageOwnershipPopup from './PackageOwnershipPopup.svelte'

  export let entry: CatalogPackage

  const dispatch = createEventDispatcher<{ close: boolean }>()
  const client = getMarketplaceClient()
  let readers: CatalogPackageReader[] = []
  let email = ''
  let loading = true
  let loaded = false
  let busy = false
  let action: 'share' | 'revoke' | undefined
  let changed = false
  let saved = false
  let error = ''

  async function load (): Promise<void> {
    loading = true
    error = ''
    try {
      readers = await client.readers(entry)
      loaded = true
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }
  void load()

  async function updateAccess (operation: 'share' | 'revoke', change: () => Promise<void>): Promise<void> {
    if (busy || loading || !loaded) return
    busy = true
    action = operation
    saved = false
    error = ''
    try {
      await change()
      changed = true
      readers = await client.readers(entry)
      saved = true
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
      action = undefined
    }
  }

  async function share (): Promise<void> {
    if (email.trim() === '') return
    await updateAccess('share', async () => {
      await client.grantRead(entry, email)
      email = ''
    })
  }

  async function revoke (reader: CatalogPackageReader): Promise<void> {
    await updateAccess('revoke', async () => {
      await client.revokeRead(entry, reader.account)
    })
  }

  function handleEmailKeydown (event: KeyboardEvent): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void share()
  }

  function transfer (): void {
    if (busy || loading || !loaded) return
    showPopup(PackageOwnershipPopup, { entry }, 'centered', (result) => {
      if (result === true) dispatch('close', true)
    })
  }

  function close (): void {
    if (!busy) dispatch('close', changed)
  }
</script>

<Dialog
  label={marketplace.string.ManagePackageAccess}
  width="44rem"
  height="min(40rem, calc(100dvh - 2rem))"
  padding="var(--spacing-4)"
  scrollable
  on:close={close}
>
  <div class="flex-col flex-gap-4">
    <div class="flex-col flex-gap-1">
      <div class="package-name font-medium">{entry.name}</div>
      <div class="text-sm content-dark-color">
        <Label
          label={entry.visibility === 'private' ? marketplace.string.PrivatePackage : marketplace.string.PublicPackage}
        />
      </div>
    </div>
    {#if loaded}
      <div data-id="package-reader-email">
        <EditBox
          label={marketplace.string.AccountEmail}
          placeholder={marketplace.string.AccountEmail}
          bind:value={email}
          disabled={busy || loading}
          autoFocus
          on:keydown={handleEmailKeydown}
        />
      </div>
    {/if}
    <div class="text-sm content-dark-color"><Label label={marketplace.string.PackageReadersDescription} /></div>
    {#if saved}<div data-id="package-access-saved">
        <Notice label={presentation.string.Saved} kind="positive" />
      </div>{/if}
    {#if error}
      <div class="flex-col flex-gap-2" data-id="package-access-error">
        <Notice label={getEmbeddedLabel(error)} kind="error" />
        {#if !loaded}<Button label={ui.string.Retry} disabled={loading} on:click={load} />{/if}
      </div>
    {/if}
    <div class="flex-col flex-gap-2">
      <div class="flex-between text-sm font-medium">
        <Label label={marketplace.string.PackageReaders} />
        {#if loaded}<span class="content-dark-color">{readers.length}</span>{/if}
      </div>
      {#if loading}
        <div class="flex-center p-4"><Spinner /></div>
      {:else if loaded && readers.length === 0}
        <div class="reader-empty text-sm content-dark-color" data-id="package-no-readers">
          <Label label={marketplace.string.NoPackageReaders} />
        </div>
      {:else}
        {#each readers as reader (reader.account)}
          <div class="reader-row flex-between flex-gap-3" data-id="package-reader">
            <span class="reader-email text-sm">{reader.email}</span>
            <Button label={ui.string.Remove} kind="ghost" disabled={busy} on:click={() => revoke(reader)} />
          </div>
        {/each}
      {/if}
    </div>
  </div>
  <svelte:fragment slot="footerLeft">
    <Button
      label={marketplace.string.TransferPackageOwnership}
      kind="ghost"
      dataId="package-open-ownership-transfer"
      disabled={busy || loading || !loaded}
      on:click={transfer}
    />
  </svelte:fragment>
  <svelte:fragment slot="footerRight">
    <Button label={presentation.string.Close} kind="ghost" disabled={busy} on:click={close} />
    <Button
      label={marketplace.string.GrantReadAccess}
      kind="primary"
      dataId="package-grant-read"
      loading={action === 'share'}
      disabled={busy || loading || !loaded || email.trim() === ''}
      on:click={share}
    />
  </svelte:fragment>
</Dialog>

<style lang="scss">
  .package-name,
  .reader-email {
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .reader-row,
  .reader-empty {
    padding: var(--spacing-2) 0;
    border-top: 1px solid var(--theme-divider-color);
  }
</style>
