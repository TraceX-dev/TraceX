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
  import { type ChatMessage, type ObjectDiscussion, ObjectDiscussionStatus } from '@hcengineering/chunter'
  import contact, { type Employee, getName } from '@hcengineering/contact'
  import { CombineAvatars, employeeRefByAccountUuidStore, getPersonByPersonId } from '@hcengineering/contact-resources'
  import { notEmpty, type Ref, SortingOrder } from '@hcengineering/core'
  import { type InboxNotification } from '@hcengineering/notification'
  import { getNotificationsCount, InboxNotificationsClientImpl } from '@hcengineering/notification-resources'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { markupToText } from '@hcengineering/text'
  import { Icon, IconCheckCircle, Label, TimeSince } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'
  import { isObjectDiscussionParticipant } from '../../utils'

  export let discussion: ObjectDiscussion
  export let linked: Attachment | undefined = undefined

  const dispatch = createEventDispatcher()
  const client = getClient()
  const inboxClient = InboxNotificationsClientImpl.getClient()
  const contextByDocStore = inboxClient.contextByDoc
  const notificationsByContextStore = inboxClient.inboxNotificationsByContext
  const lastMessageQuery = createQuery()

  let lastMessage: ChatMessage | undefined = undefined
  let lastMessageText = ''
  let unreadCount = 0

  $: resolved = discussion.status === ObjectDiscussionStatus.Resolved
  $: memberRefs = discussion.members
    .map((account) => $employeeRefByAccountUuidStore.get(account) as Ref<Employee> | undefined)
    .filter(notEmpty)

  // Messages are readable only after joining, so non-participants get no preview.
  $: joined = isObjectDiscussionParticipant(discussion)
  $: if (joined) {
    lastMessageQuery.query(
      chunter.class.ChatMessage,
      { attachedTo: discussion._id, attachedToClass: discussion._class },
      (result) => {
        lastMessage = result[0]
      },
      { sort: { createdOn: SortingOrder.Descending }, limit: 1 }
    )
  } else {
    lastMessageQuery.unsubscribe()
    lastMessage = undefined
  }

  $: void formatLastMessage(lastMessage).then((text) => {
    lastMessageText = text
  })

  $: context = $contextByDocStore.get(discussion._id)
  $: notifications = context !== undefined ? ($notificationsByContextStore.get(context._id) ?? []) : []
  $: void updateUnreadCount(notifications)
  $: hasUnread = context !== undefined && (context.lastViewedTimestamp ?? 0) < (context.lastUpdateTimestamp ?? 0)

  async function updateUnreadCount (notifications: InboxNotification[]): Promise<void> {
    unreadCount = await getNotificationsCount(context, notifications)
  }

  async function formatLastMessage (message: ChatMessage | undefined): Promise<string> {
    if (message === undefined) return ''
    const text = markupToText(message.message).trim()
    const author = message.createdBy !== undefined ? await getPersonByPersonId(message.createdBy) : null
    return author != null ? `${getName(client.getHierarchy(), author)}: ${text}` : text
  }

  function open (): void {
    dispatch('open', discussion)
  }

  function handleKeydown (event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }
</script>

<div
  class="discussion-row"
  class:unread={hasUnread && !resolved}
  class:resolved
  role="button"
  tabindex="0"
  on:click={open}
  on:keydown={handleKeydown}
>
  <div class="state">
    {#if resolved}
      <span class="resolved-icon"><Icon icon={IconCheckCircle} size="small" /></span>
    {:else}
      <span class="dot" class:active={hasUnread} />
    {/if}
  </div>

  <div class="content">
    <div class="title-row">
      <span class="title overflow-label">{discussion.name}</span>
      {#if linked !== undefined}
        <span class="linked">
          <Icon icon={attachment.icon.Attachment} size="x-small" />
          <span class="overflow-label">{linked.name}</span>
        </span>
      {/if}
    </div>
    <div class="subtitle overflow-label">
      {#if resolved}
        <Label label={chunter.string.Resolved} /> ·
        <Label label={chunter.string.ParticipantsCount} params={{ count: discussion.members.length }} />
      {:else if !joined}
        <Label label={chunter.string.ParticipantsCount} params={{ count: discussion.members.length }} />
      {:else if lastMessageText !== ''}
        {lastMessageText}
      {:else}
        <Label label={chunter.string.NoMessagesInChannel} />
      {/if}
    </div>
  </div>

  <div class="avatars">
    <CombineAvatars _class={contact.mixin.Employee} items={memberRefs} size="x-small" limit={3} />
  </div>

  <div class="meta">
    <span class="time"><TimeSince value={lastMessage?.createdOn ?? discussion.modifiedOn} /></span>
    {#if unreadCount > 0 && !resolved}
      <span class="counter">{unreadCount}</span>
    {/if}
  </div>
</div>

<style lang="scss">
  .discussion-row {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.5rem 0.875rem;
    border-bottom: 1px solid var(--theme-divider-color);
    cursor: pointer;

    &:last-child {
      border-bottom: none;
    }

    &:hover,
    &:focus-visible {
      background: var(--global-ui-hover-highlight-BackgroundColor);
      outline: none;
    }

    &.unread {
      background: var(--global-ui-highlight-BackgroundColor);
    }

    &.resolved {
      .title {
        color: var(--global-secondary-TextColor);
      }

      .avatars {
        opacity: 0.6;
      }
    }
  }

  .state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1rem;
    height: 1.25rem;
  }

  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--global-ui-BorderColor);

    &.active {
      background: var(--global-accent-BackgroundColor);
    }
  }

  .resolved-icon {
    display: flex;
    color: var(--global-online-color);
  }

  .content {
    flex: 1;
    min-width: 0;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    height: 1.25rem;
  }

  .title {
    color: var(--global-primary-TextColor);
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;
  }

  .linked {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    max-width: 12rem;
    padding: 0.125rem 0.5rem;
    border-radius: 0.375rem;
    background: var(--global-ui-highlight-BackgroundColor);
    color: var(--global-secondary-TextColor);
    font-size: 0.6875rem;
  }

  .subtitle {
    color: var(--global-secondary-TextColor);
    font-size: 0.75rem;
    line-height: 1.125rem;
  }

  .avatars {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    height: 1.25rem;
  }

  .meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
    flex-shrink: 0;
    min-width: 3.5rem;
  }

  .time {
    color: var(--global-tertiary-TextColor);
    font-size: 0.75rem;
    line-height: 1.25rem;
    white-space: nowrap;
  }

  .counter {
    min-width: 1.125rem;
    height: 1.125rem;
    padding: 0 0.3125rem;
    border-radius: 0.5625rem;
    background: var(--global-accent-BackgroundColor);
    color: var(--global-on-accent-TextColor);
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1.125rem;
    text-align: center;
  }
</style>
