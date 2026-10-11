<!--
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
  import { type AccountAggregatedInfo } from '@hcengineering/account-client'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { Modal, Scroller } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  export let account: AccountAggregatedInfo

  const dispatch = createEventDispatcher()

  function formatLastVisit (lastVisit: number | undefined): string {
    return lastVisit == null ? '—' : new Date(lastVisit).toLocaleString()
  }
</script>

<Modal
  label={getEmbeddedLabel('Account details')}
  type="type-popup"
  width="medium"
  showCancelButton={false}
  onCancel={() => {
    dispatch('close')
  }}
>
  <Scroller maxHeight={32} noStretch={true}>
    <div class="account-details">
      <div>
        <div class="account-details-label">Name</div>
        <div>{account.firstName} {account.lastName}</div>
      </div>
      <div>
        <div class="account-details-label">Account ID</div>
        <div class="select-text-i">{account.uuid}</div>
      </div>
      <div>
        <div class="account-details-label">Last visit</div>
        <div>{formatLastVisit(account.lastVisit)}</div>
      </div>
      <div>
        <div class="account-details-label">Social IDs</div>
        {#each account.socialIds as socialId}
          <div>{socialId.type}:{socialId.value}</div>
        {/each}
      </div>
      <div>
        <div class="account-details-label">Workspaces</div>
        {#each account.workspaces as workspace}
          <div>{workspace.name} {workspace.url} {workspace.uuid} {workspace.dataId}</div>
        {/each}
      </div>
    </div>
  </Scroller>
</Modal>

<style lang="scss">
  .account-details {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }

  .account-details-label {
    margin-bottom: 0.25rem;
    color: var(--theme-dark-color);
  }
</style>
