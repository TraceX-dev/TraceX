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
  import { type ObjectDiscussion, ObjectDiscussionStatus } from '@hcengineering/chunter'
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import { type AccountUuid, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import {
    ButtonIcon,
    Icon,
    IconCheckCircle,
    IconClose,
    IconDelete,
    IconDropdown,
    IconEdit,
    IconMoreH,
    Label,
    ModernPopup,
    eventToHTMLElement,
    showPopup
  } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'
  import { canManageObjectDiscussion, deleteObjectDiscussion, setObjectDiscussionStatus } from '../../utils'

  export let discussion: ObjectDiscussion
  export let allowClose: boolean = false

  const dispatch = createEventDispatcher()
  const client = getClient()
  const linkedQuery = createQuery()

  let linked: Attachment | undefined = undefined
  let editing = false
  let draftName = ''

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

  $: resolved = discussion.status === ObjectDiscussionStatus.Resolved

  const statusItems = [
    { id: ObjectDiscussionStatus.Active, label: chunter.string.Active },
    { id: ObjectDiscussionStatus.Resolved, label: chunter.string.Resolved, icon: IconCheckCircle }
  ]

  function openStatusMenu (ev: MouseEvent): void {
    if (!canManage) return
    showPopup(ModernPopup, { items: statusItems, selected: discussion.status }, eventToHTMLElement(ev), (result) => {
      if (result == null) return
      void setObjectDiscussionStatus(discussion, result as ObjectDiscussionStatus)
    })
  }

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
          void setObjectDiscussionStatus(discussion, ObjectDiscussionStatus.Resolved)
          break
        case 'reopen':
          void setObjectDiscussionStatus(discussion, ObjectDiscussionStatus.Active)
          break
        case 'delete':
          void deleteObjectDiscussion(discussion)
          break
      }
    })
  }

  function startEditing (): void {
    draftName = discussion.name
    editing = true
  }

  async function finishEditing (): Promise<void> {
    if (!editing) return
    editing = false
    const name = draftName.trim()
    if (name !== '' && name !== discussion.name) {
      await client.update(discussion, { name })
    }
  }

  function handleTitleKeydown (event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      void finishEditing()
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      editing = false
    }
  }

  async function updateMembers (members: AccountUuid[]): Promise<void> {
    await client.update(discussion, { members })
  }

  async function unlink (): Promise<void> {
    await client.update(discussion, { $unset: { linkedTo: true, linkedToClass: true } })
  }

  function focus (node: HTMLInputElement): void {
    node.focus()
    node.select()
  }
</script>

<div class="discussion-header">
  <div class="title-row">
    <Icon icon={chunter.icon.Thread} size="small" />
    {#if editing}
      <input
        class="title-input"
        bind:value={draftName}
        use:focus
        on:keydown={handleTitleKeydown}
        on:blur={() => void finishEditing()}
      />
    {:else}
      <span class="title overflow-label">{discussion.name}</span>
      {#if canManage}
        <ButtonIcon icon={IconEdit} size="small" kind="tertiary" on:click={startEditing} />
      {/if}
    {/if}
    {#if allowClose}
      <ButtonIcon icon={IconClose} size="small" kind="tertiary" on:click={() => dispatch('close')} />
    {/if}
  </div>

  <div class="status-row">
    <button class="status-pill" class:resolved class:readonly={!canManage} type="button" on:click={openStatusMenu}>
      {#if resolved}
        <Icon icon={IconCheckCircle} size="x-small" />
      {:else}
        <span class="status-dot" />
      {/if}
      <Label label={resolved ? chunter.string.Resolved : chunter.string.Active} />
      {#if canManage}
        <Icon icon={IconDropdown} size="x-small" />
      {/if}
    </button>
    <AccountArrayEditor
      value={discussion.members}
      label={chunter.string.Members}
      readonly={!canManage}
      onChange={updateMembers}
      kind="ghost"
      size="small"
    />
    <div class="spacer" />
    {#if canManage}
      <ButtonIcon icon={IconMoreH} size="small" kind="tertiary" on:click={openMenu} />
    {/if}
  </div>
</div>

{#if linked !== undefined}
  <div class="discussion-scope">
    <div class="linked-chip">
      <Icon icon={attachment.icon.Attachment} size="x-small" />
      <span class="overflow-label"><Label label={chunter.string.AttachedTo} params={{ name: linked.name }} /></span>
      {#if canManage}
        <button class="chip-remove" type="button" on:click={() => void unlink()}>
          <Icon icon={IconClose} size="tiny" />
        </button>
      {/if}
    </div>
  </div>
{/if}

<style lang="scss">
  .discussion-header {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 1.25rem 0.875rem;
    border-bottom: 1px solid var(--global-ui-BorderColor);
    color: var(--global-primary-TextColor);
  }

  .title-row,
  .status-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-width: 0;
  }

  .title {
    flex: 1;
    min-width: 0;
    font-size: 1rem;
    font-weight: 700;
  }

  .title-input {
    flex: 1;
    min-width: 0;
    padding: 0.125rem 0.375rem;
    border: 1px solid var(--global-accent-BackgroundColor);
    border-radius: var(--small-BorderRadius);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 1rem;
    font-weight: 700;
    outline: none;
  }

  .spacer {
    flex: 1;
  }

  button {
    border: 0;
    background: transparent;
    font-family: inherit;
    color: inherit;
    cursor: pointer;
  }

  .status-pill {
    display: flex;
    align-items: center;
    gap: 0.3125rem;
    padding: 0.3125rem 0.6875rem;
    flex-shrink: 0;
    border-radius: 1rem;
    background: var(--theme-button-default);
    color: var(--global-secondary-TextColor);
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;

    .status-dot {
      background: var(--global-accent-BackgroundColor);
    }

    &.resolved :global(svg) {
      color: var(--global-online-color);
    }

    &.readonly {
      cursor: default;
    }
  }

  .status-dot {
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
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

  .chip-remove {
    display: flex;
    padding: 0;
    color: var(--global-tertiary-TextColor);

    &:hover {
      color: var(--global-primary-TextColor);
    }
  }
</style>
