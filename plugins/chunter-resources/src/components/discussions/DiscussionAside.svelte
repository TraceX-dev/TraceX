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
  import { type Discussion } from '@hcengineering/chunter'
  import { type Ref } from '@hcengineering/core'
  import { InboxNotificationsClientImpl } from '@hcengineering/notification-resources'
  import { createQuery } from '@hcengineering/presentation'
  import { Presence } from '@hcengineering/presence-resources'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'
  import Channel from '../Channel.svelte'
  import { isDiscussionParticipant } from '../../utils'
  import DiscussionHeader from './DiscussionHeader.svelte'
  import DiscussionJoin from './DiscussionJoin.svelte'

  export let discussionId: Ref<Discussion>

  const dispatch = createEventDispatcher()
  const contextByDocStore = InboxNotificationsClientImpl.getClient().contextByDoc
  const query = createQuery()

  let discussion: Discussion | undefined = undefined

  $: query.query(chunter.class.Discussion, { _id: discussionId }, (result) => {
    discussion = result[0]
    // The discussion was deleted or became inaccessible.
    if (discussion === undefined) dispatch('close')
  })

  // Like channels, messages are hidden until the user joins the discussion.
  $: joined = discussion !== undefined && isDiscussionParticipant(discussion)
  $: context = discussion !== undefined ? $contextByDocStore.get(discussion._id) : undefined
</script>

{#if discussion !== undefined}
  <Presence object={discussion} />
  <div class="discussion-aside">
    <DiscussionHeader {discussion} allowClose on:close />
    {#if joined}
      {#key discussion._id}
        <Channel object={discussion} {context} syncLocation={false} />
      {/key}
    {:else}
      <DiscussionJoin {discussion} />
    {/if}
  </div>
{/if}

<style lang="scss">
  .discussion-aside {
    display: flex;
    flex-direction: column;
    flex: 1;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
</style>
