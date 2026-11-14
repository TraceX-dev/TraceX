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
  import attachmentPlugin, { Attachment } from '@hcengineering/attachment'
  import { getCurrentAccount, type WithLookup } from '@hcengineering/core'
  import presentation, { getClient, getFileUrl } from '@hcengineering/presentation'
  import { Button, IconMoreH, Menu, showPopup } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { AttachmentGalleryPresenter } from '..'
  import FileDownload from './icons/FileDownload.svelte'

  export let attachments: WithLookup<Attachment>[]
  let hoveredFileNumber: number | undefined
  const client = getClient()

  function downloadFile (attachment: WithLookup<Attachment>): void {
    const link = document.createElement('a')
    link.href = getFileUrl(attachment.file, attachment.name)
    link.download = attachment.name
    link.click()
  }

  function showFileMenu (ev: MouseEvent, attachment: WithLookup<Attachment>, fileNumber: number): void {
    hoveredFileNumber = fileNumber
    showPopup(
      Menu,
      {
        actions: [
          {
            icon: FileDownload,
            label: presentation.string.Download,
            action: async () => {
              downloadFile(attachment)
            }
          },
          ...(getCurrentAccount().socialIds.includes(attachment.modifiedBy)
            ? [
                {
                  icon: view.icon.Delete,
                  label: attachmentPlugin.string.DeleteFile,
                  action: async () => await client.removeDoc(attachment._class, attachment.space, attachment._id)
                }
              ]
            : [])
        ]
      },
      ev.target as HTMLElement,
      () => {
        hoveredFileNumber = undefined
      }
    )
  }
</script>

<div class="galleryGrid">
  {#each attachments as attachment, i}
    <div class="attachmentCell" class:hovered={i === hoveredFileNumber}>
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <AttachmentGalleryPresenter value={attachment}>
        <svelte:fragment slot="rowMenu">
          <div class="tools">
            <Button
              icon={IconMoreH}
              kind="ghost"
              size="medium"
              showTooltip={{ label: view.string.MoreActions, direction: 'bottom' }}
              on:click={(event) => {
                showFileMenu(event, attachment, i)
              }}
            />
          </div>
        </svelte:fragment>
      </AttachmentGalleryPresenter>
    </div>
  {/each}
</div>

<style lang="scss">
  .galleryGrid {
    display: grid;
    margin: 0 1.5rem;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  }

  .attachmentCell {
    .tools {
      display: none;
    }

    &:hover,
    &.hovered {
      .tools {
        display: block;
      }
    }
  }
</style>
