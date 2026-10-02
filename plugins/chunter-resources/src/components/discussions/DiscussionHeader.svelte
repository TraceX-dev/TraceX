<!--
//
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
  import { type Discussion, getDiscussionTitle } from '@hcengineering/chunter'
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import { type AccountUuid, type ObjectVisibility } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import {
    ButtonIcon,
    Icon,
    IconCheckCircle,
    IconClose,
    IconDelete,
    IconMoreH,
    Label,
    EditBox,
    ModernPopup,
    eventToHTMLElement,
    showPopup,
    tooltip
  } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'
  import {
    canChangeDiscussionVisibility,
    canEditDiscussionMembers,
    canManageDiscussion,
    deleteDiscussion,
    getDiscussionVisibility,
    setDiscussionResolved,
    setDiscussionVisibility
  } from '../../utils'
  import DiscussionVisibilityMenu from './DiscussionVisibilityMenu.svelte'

  export let discussion: Discussion
  export let allowClose: boolean = false

  const dispatch = createEventDispatcher()
  const client = getClient()

  let title = ''

  $: canManage = canManageDiscussion(discussion)
  $: canChangeVisibility = canChangeDiscussionVisibility(discussion)
  $: canEditMembers = canEditDiscussionMembers(discussion)
  $: visibility = getDiscussionVisibility(discussion)

  $: displayTitle = getDiscussionTitle(discussion)
  $: fallbackTitle = getDiscussionTitle({ excerpt: discussion.excerpt })

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
          void setDiscussionResolved(discussion, true)
          break
        case 'reopen':
          void setDiscussionResolved(discussion, false)
          break
        case 'delete':
          void deleteDiscussion(discussion)
          break
      }
    })
  }

  // Keeps the draft while the user is typing; synced from the discussion otherwise.
  let isTitleEditing = false
  $: if (!isTitleEditing) title = discussion.name ?? ''

  async function saveTitle (): Promise<void> {
    isTitleEditing = false
    const name = title.trim()
    if (name !== (discussion.name ?? '').trim()) {
      await client.update(discussion, { name })
    } else {
      title = discussion.name ?? ''
    }
  }

  async function changeVisibility (value: ObjectVisibility): Promise<void> {
    await setDiscussionVisibility(discussion, value)
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
</script>

<div class="discussion-header">
  <Icon icon={chunter.icon.Thread} size="small" />
  <div class="title">
    {#if canManage}
      <EditBox
        bind:value={title}
        placeholder={fallbackTitle !== undefined ? getEmbeddedLabel(fallbackTitle) : chunter.string.Topic}
        fullSize
        on:value={() => {
          isTitleEditing = true
        }}
        on:keydown={handleTitleKeydown}
        on:blur={() => void saveTitle()}
      />
    {:else}
      <span class="overflow-label">
        {#if displayTitle !== undefined}{displayTitle}{:else}<Label label={chunter.string.UntitledDiscussion} />{/if}
      </span>
    {/if}
  </div>
  {#if resolved}
    <span class="resolved" use:tooltip={{ label: chunter.string.Resolved }}>
      <Icon icon={IconCheckCircle} size="small" />
    </span>
  {/if}
  <DiscussionVisibilityMenu
    value={visibility}
    parentClass={discussion.attachedToClass}
    disabled={!canChangeVisibility}
    kind="tertiary"
    size="small"
    iconOnly
    on:change={(ev) => void changeVisibility(ev.detail)}
  />
  {#if visibility === 'private'}
    <div class="members">
      <AccountArrayEditor
        value={discussion.members}
        label={chunter.string.Members}
        readonly={!canEditMembers}
        onChange={updateMembers}
        kind="ghost"
        size="small"
      />
    </div>
  {/if}
  {#if canManage}
    <ButtonIcon icon={IconMoreH} size="small" kind="tertiary" on:click={openMenu} />
  {/if}
  {#if allowClose}
    <ButtonIcon icon={IconClose} size="small" kind="tertiary" on:click={() => dispatch('close')} />
  {/if}
</div>

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
</style>
