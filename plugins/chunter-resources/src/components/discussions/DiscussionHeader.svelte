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
  import { type AccountUuid, getCurrentAccount, type ObjectVisibility } from '@hcengineering/core'
  import { getClient, MessageBox } from '@hcengineering/presentation'
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
    canDeleteDiscussion,
    canEditDiscussionMembers,
    canManageDiscussion,
    canRenameDiscussion,
    deleteDiscussion,
    getDiscussionVisibility,
    normalizeDiscussionMembers,
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
  // A default discussion gets its name from the owner type and cannot be deleted while configured there.
  $: canRename = canRenameDiscussion(discussion)
  $: canDelete = canDeleteDiscussion(discussion)
  $: canChangeVisibility = canChangeDiscussionVisibility(discussion)
  $: canEditMembers = canEditDiscussionMembers(discussion)
  $: visibility = getDiscussionVisibility(discussion)

  $: displayTitle = getDiscussionTitle(discussion)

  $: resolved = discussion.resolved

  function openMenu (ev: MouseEvent): void {
    const items = [
      resolved
        ? { id: 'reopen', label: chunter.string.ReopenDiscussion, icon: IconCheckCircle }
        : { id: 'resolve', label: chunter.string.MarkAsResolved, icon: IconCheckCircle },
      ...(canDelete ? [{ id: 'delete', label: chunter.string.DeleteDiscussion, icon: IconDelete }] : [])
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

  // The draft stays until the update is stored, so the old title does not flash back.
  async function saveTitle (): Promise<void> {
    const name = title.trim()
    try {
      if (canRename && name !== (discussion.name ?? '').trim()) await client.update(discussion, { name })
    } finally {
      isTitleEditing = false
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

  async function updateMembers (value: AccountUuid[]): Promise<void> {
    const members = normalizeDiscussionMembers(discussion, value)
    if (members === undefined) return // a private discussion keeps at least one member
    const me = getCurrentAccount().uuid
    if (discussion.members.includes(me) && !members.includes(me)) {
      // Leaving a private discussion hides it, ask first.
      showPopup(MessageBox, {
        label: chunter.string.LeaveDiscussion,
        message: chunter.string.LeaveDiscussionConfirm,
        action: async () => {
          await client.update(discussion, { members })
        }
      })
      return
    }
    await client.update(discussion, { members })
  }
</script>

<div class="discussion-header">
  <Icon icon={chunter.icon.Thread} size="small" />
  <div class="title">
    {#if canRename}
      <EditBox
        bind:value={title}
        placeholder={chunter.string.UntitledDiscussion}
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
