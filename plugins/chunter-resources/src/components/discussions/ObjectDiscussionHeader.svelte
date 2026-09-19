<!--
//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import attachment, { type Attachment } from '@hcengineering/attachment'
  import { type ObjectDiscussion } from '@hcengineering/chunter'
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import { type AccountUuid, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import {
    ButtonIcon,
    Icon,
    IconCheckCircle,
    IconClose,
    IconDelete,
    IconMoreH,
    EditBox,
    Label,
    ModernPopup,
    eventToHTMLElement,
    showPopup,
    tooltip
  } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'
  import { canManageObjectDiscussion, deleteObjectDiscussion, setObjectDiscussionResolved } from '../../utils'

  export let discussion: ObjectDiscussion
  export let allowClose: boolean = false

  const dispatch = createEventDispatcher()
  const client = getClient()
  const linkedQuery = createQuery()

  let linked: Attachment | undefined = undefined
  let title = ''

  $: canManage = canManageObjectDiscussion(discussion)

  $: if (discussion.linkedTo !== undefined) {
    linkedQuery.query(
      attachment.class.Attachment,
      { _id: discussion.linkedTo as Ref<Attachment> },
      (result) => {
        linked = result[0]
      },
      { limit: 1 }
    )
  } else {
    linkedQuery.unsubscribe()
    linked = undefined
  }

  $: resolved = discussion.resolved

  function openMenu (ev: MouseEvent): void {
    const items = [
      resolved
        ? { id: 'reopen', label: chunter.string.ReopenDiscussion, icon: IconCheckCircle }
        : { id: 'resolve', label: chunter.string.MarkAsResolved, icon: IconCheckCircle },
      { id: 'delete', label: chunter.string.DeleteDiscussion, icon: IconDelete }
    ]
    showPopup(ModernPopup, { items }, eventToHTMLElement(ev), (result) => {
      switch (result) {
        case 'resolve':
          void setObjectDiscussionResolved(discussion, true)
          break
        case 'reopen':
          void setObjectDiscussionResolved(discussion, false)
          break
        case 'delete':
          void deleteObjectDiscussion(discussion)
          break
      }
    })
  }

  // Keeps the draft while the user is typing; synced from the discussion otherwise.
  let isTitleEditing = false
  $: if (!isTitleEditing) title = discussion.name

  async function saveTitle (): Promise<void> {
    isTitleEditing = false
    const name = title.trim()
    if (name !== '' && name !== discussion.name) {
      await client.update(discussion, { name })
    } else {
      title = discussion.name
    }
  }

  function handleTitleKeydown (event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      ;(event.target as HTMLInputElement).blur()
    }
  }

  async function updateMembers (members: AccountUuid[]): Promise<void> {
    await client.update(discussion, { members })
  }

  async function unlink (): Promise<void> {
    await client.update(discussion, { $unset: { linkedTo: true, linkedToClass: true } })
  }
</script>

<div class="discussion-header">
  <Icon icon={chunter.icon.Thread} size="small" />
  <div class="title">
    {#if canManage}
      <EditBox
        bind:value={title}
        placeholder={chunter.string.Topic}
        fullSize
        on:value={() => {
          isTitleEditing = true
        }}
        on:keydown={handleTitleKeydown}
        on:blur={() => void saveTitle()}
      />
    {:else}
      <span class="overflow-label">{discussion.name}</span>
    {/if}
  </div>
  {#if resolved}
    <span class="resolved" use:tooltip={{ label: chunter.string.Resolved }}>
      <Icon icon={IconCheckCircle} size="small" />
    </span>
  {/if}
  <div class="members">
    <AccountArrayEditor
      value={discussion.members}
      label={chunter.string.Members}
      readonly={!canManage}
      onChange={updateMembers}
      kind="ghost"
      size="small"
    />
  </div>
  {#if canManage}
    <ButtonIcon icon={IconMoreH} size="small" kind="tertiary" on:click={openMenu} />
  {/if}
  {#if allowClose}
    <ButtonIcon icon={IconClose} size="small" kind="tertiary" on:click={() => dispatch('close')} />
  {/if}
</div>

{#if linked !== undefined}
  <div class="discussion-scope">
    <div class="linked-chip">
      <Icon icon={attachment.icon.Attachment} size="x-small" />
      <span class="overflow-label"><Label label={chunter.string.AttachedTo} params={{ name: linked.name }} /></span>
      {#if canManage}
        <ButtonIcon icon={IconClose} size="min" kind="tertiary" on:click={() => void unlink()} />
      {/if}
    </div>
  </div>
{/if}

<style lang="scss">
  .discussion-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--global-ui-BorderColor);
    color: var(--global-primary-TextColor);
  }

  .title {
    display: flex;
    flex: 1;
    min-width: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .resolved {
    display: flex;
    flex-shrink: 0;
    color: var(--global-online-color);
  }

  .members {
    display: flex;
    flex-shrink: 0;
    max-width: 50%;
    min-width: 0;
  }

  .discussion-scope {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid var(--global-ui-BorderColor);
  }

  .linked-chip {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    width: fit-content;
    max-width: 100%;
    padding: 0.3125rem 0.625rem;
    border-radius: var(--small-BorderRadius);
    background: var(--global-ui-highlight-BackgroundColor);
    color: var(--global-secondary-TextColor);
    font-size: 0.75rem;
    font-weight: 600;
  }
</style>
