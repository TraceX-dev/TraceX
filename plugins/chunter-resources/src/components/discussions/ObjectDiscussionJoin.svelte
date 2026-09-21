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
  import { Label, ModernButton } from '@hcengineering/ui'
  import view from '@hcengineering/view'

  import chunter from '../../plugin'
  import { canCreateObjectDiscussion, joinObjectDiscussion } from '../../utils'

  export let discussion: ObjectDiscussion

  // Guests cannot update the discussion, so they have to be added by a participant.
  const canJoin = canCreateObjectDiscussion()
  let joining = false

  async function join (): Promise<void> {
    joining = true
    try {
      await joinObjectDiscussion(discussion)
    } finally {
      joining = false
    }
  }
</script>

<div class="join h-full w-full clear-mins flex-center">
  <div class="join-overlay">
    {#if canJoin}
      <div class="an-element__label header">
        <Label label={chunter.string.JoinChannelHeader} />
      </div>
      <span class="an-element__label">
        <Label label={chunter.string.JoinChannelText} />
      </span>
      <span class="mt-4" />
      <ModernButton
        label={view.string.Join}
        kind={'primary'}
        dataId={'btnJoinDiscussion'}
        loading={joining}
        on:click={join}
      />
    {:else}
      <span class="an-element__label">
        <Label label={chunter.string.JoinDiscussionRequest} />
      </span>
    {/if}
  </div>
</div>

<style lang="scss">
  .join-overlay {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    max-width: 35rem;
    padding: 0 1rem;
    text-align: center;
  }

  .header {
    margin: 1rem;
    font-weight: 600;
  }
</style>
