<!--
// Copyright © 2022 Hardcore Engineering Inc.
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
  import type { Attachment } from '@hcengineering/attachment'
  import type { WithLookup } from '@hcengineering/core'
  import { getFileUrl } from '@hcengineering/presentation'
  import { humanReadableFileSize } from '@hcengineering/ui'
  import { PersonIdPresenter } from '@hcengineering/view-resources'
  import { getType, showAttachmentPreviewPopup } from '../utils'

  export let value: WithLookup<Attachment>

  function extensionIconLabel (name: string): string {
    const parts = name.split('.')
    const ext = parts[parts.length - 1]
    return ext.substring(0, 4).toUpperCase()
  }

  function isImage (contentType: string): boolean {
    return getType(contentType) === 'image'
  }

  function isEmbedded (contentType: string): boolean {
    return getType(contentType) !== 'other'
  }

  function openAttachment (): void {
    showAttachmentPreviewPopup(value)
  }

  $: src = getFileUrl(value.file, value.name)
</script>

<div class="gridCellOverlay">
  <div class="gridCell">
    {#if isImage(value.type)}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="cellImagePreview" on:click={openAttachment}>
        <img class={'img-fit'} {src} alt={value.name} />
      </div>
    {:else}
      <div class="cellMiscPreview">
        {#if isEmbedded(value.type)}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="flex-center extensionIcon" on:click={openAttachment}>
            {extensionIconLabel(value.name)}
          </div>
        {:else}
          <a class="no-line" href={src} download={value.name}>
            <div class="flex-center extensionIcon">{extensionIconLabel(value.name)}</div>
          </a>
        {/if}
      </div>
    {/if}

    <div class="header flex-col p-2 pt-1">
      <div class="flex-row-center flex-between flex-gap-2 h-8 fs-bold">
        {#if isEmbedded(value.type)}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="flex-presenter">
            <div class="label overflow-label flex-grow" on:click={openAttachment}>
              {value.name}
            </div>
          </div>
        {:else}
          <div class="flex-presenter">
            <div class="label overflow-label flex-grow">
              <a href={src} download={value.name}>{value.name}</a>
            </div>
          </div>
        {/if}
        <slot name="rowMenu" />
      </div>
      <div class="flex-between flex-gap-2 h-4 font-regular-12">
        <PersonIdPresenter value={value.modifiedBy} withPadding={false} noUnderline avatarSize="tiny" />
        <span class="caption-color overflow-label flex-no-shrink">{humanReadableFileSize(value.size)}</span>
      </div>
    </div>
  </div>
</div>

<style lang="scss">
  .gridCellOverlay {
    position: relative;
    padding: 0.5rem;
  }

  .gridCell {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: 0.75rem;
    justify-content: space-between;
    overflow: hidden;
    border: 1px solid var(--theme-divider-color);
  }

  .cellImagePreview {
    display: flex;
    justify-content: center;
    height: 10rem;
    overflow: hidden;
    background-color: var(--theme-bg-color);
    cursor: pointer;
  }

  .cellMiscPreview {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 10rem;
  }

  .img-fit {
    object-fit: cover;
    height: 100%;
    width: 100%;
  }

  .header {
    border-top: 1px solid var(--theme-divider-color);
    padding: 0.25rem 0.5rem 0.5rem;
  }

  .extensionIcon {
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    font-weight: 500;
    font-size: 0.625rem;
    color: var(--primary-button-color);
    background-color: var(--primary-button-default);
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0.5rem;
    cursor: pointer;
  }
</style>
