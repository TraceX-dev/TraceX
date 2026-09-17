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
  import { type ObjectDiscussion } from '@hcengineering/chunter'
  import { type Ref } from '@hcengineering/core'
  import { InboxNotificationsClientImpl } from '@hcengineering/notification-resources'
  import { createQuery } from '@hcengineering/presentation'
  import { Presence } from '@hcengineering/presence-resources'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'
  import Channel from '../Channel.svelte'
  import ChannelHeader from '../ChannelHeader.svelte'

  export let discussionId: Ref<ObjectDiscussion>

  const dispatch = createEventDispatcher()
  const contextByDocStore = InboxNotificationsClientImpl.getClient().contextByDoc
  const query = createQuery()

  let discussion: ObjectDiscussion | undefined = undefined

  $: query.query(chunter.class.ObjectDiscussion, { _id: discussionId }, (result) => {
    discussion = result[0]
    // The discussion was deleted or became inaccessible.
    if (discussion === undefined) dispatch('close')
  })

  $: context = discussion !== undefined ? $contextByDocStore.get(discussion._id) : undefined
</script>

{#if discussion !== undefined}
  <Presence object={discussion} />
  <div class="discussion-aside">
    <ChannelHeader
      _id={discussion._id}
      _class={discussion._class}
      object={discussion}
      withAside={false}
      withSearch={false}
      allowClose
      canOpenInSidebar={false}
      closeOnEscape={false}
      on:close
    />
    {#key discussion._id}
      <Channel object={discussion} {context} syncLocation={false} />
    {/key}
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
