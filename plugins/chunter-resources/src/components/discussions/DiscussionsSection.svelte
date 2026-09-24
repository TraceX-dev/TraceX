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
  import { type Discussion } from '@hcengineering/chunter'
  import { type Doc, type Ref, SortingOrder } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import ui, { Button, ButtonIcon, IconAdd, Label, Section, showPopup } from '@hcengineering/ui'
  import { permissions } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'
  import { canCreateDiscussion } from '../../utils'
  import CreateDiscussion from './CreateDiscussion.svelte'
  import DiscussionRow from './DiscussionRow.svelte'

  export let doc: Doc
  export let readonly: boolean = false
  export let hidden: boolean = false

  const COLLAPSED_LIMIT = 3

  const dispatch = createEventDispatcher()
  const discussionsQuery = createQuery()

  let discussions: Discussion[] = []
  let expanded = false

  $: discussionsQuery.query(
    chunter.class.Discussion,
    { attachedTo: doc._id },
    (result) => {
      discussions = result.sort(compareDiscussions)
      dispatch('loaded')
    },
    { sort: { modifiedOn: SortingOrder.Descending } }
  )

  $: canCreate = canCreateDiscussion() && $permissions.canComment(doc)

  $: visibleDiscussions = expanded ? discussions : discussions.slice(0, COLLAPSED_LIMIT)

  function compareDiscussions (left: Discussion, right: Discussion): number {
    if (left.resolved !== right.resolved) {
      return left.resolved ? 1 : -1
    }
    return (right.modifiedOn ?? 0) - (left.modifiedOn ?? 0)
  }

  function createDiscussion (): void {
    showPopup(CreateDiscussion, { object: doc }, 'top', (result?: Ref<Discussion>) => {
      if (result != null) openDiscussion(result)
    })
  }

  // The owner panel shows the discussion in its aside, so it closes together with the object.
  function openDiscussion (discussionId: Ref<Discussion>): void {
    dispatch('action', {
      id: 'aside',
      component: chunter.component.DiscussionAside,
      props: { discussionId }
    })
  }
</script>

{#if !hidden}
  <div class="discussions-section">
    <Section label={chunter.string.Discussions} icon={chunter.icon.Thread} counter={discussions.length}>
      <div slot="header" class="buttons-group small-gap">
        {#if !readonly && canCreate}
          <ButtonIcon
            icon={IconAdd}
            kind="tertiary"
            size="small"
            tooltip={{ label: chunter.string.NewDiscussion }}
            on:click={createDiscussion}
          />
        {/if}
      </div>

      <svelte:fragment slot="content">
        {#if discussions.length === 0}
          <div class="antiSection-empty flex-col mt-3">
            <span class="text-sm content-dark-color"><Label label={chunter.string.NoDiscussionsYet} /></span>
            {#if !readonly && canCreate}
              <Button kind="link" size="small" label={chunter.string.NewDiscussion} on:click={createDiscussion} />
            {/if}
          </div>
        {:else}
          <div class="discussions mt-3">
            {#each visibleDiscussions as discussion (discussion._id)}
              <DiscussionRow
                {discussion}
                on:open={(event) => {
                  openDiscussion(event.detail._id)
                }}
              />
            {/each}

            {#if discussions.length > COLLAPSED_LIMIT}
              <div class="footer">
                <Button
                  kind="ghost"
                  width="100%"
                  label={expanded ? ui.string.ShowLess : chunter.string.ViewAllDiscussions}
                  labelParams={{ count: discussions.length }}
                  on:click={() => (expanded = !expanded)}
                />
              </div>
            {/if}
          </div>
        {/if}
      </svelte:fragment>
    </Section>
  </div>
{/if}

<style lang="scss">
  .discussions-section {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 0 1rem;
  }

  .discussions {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.75rem;
  }

  .footer {
    padding: 0.25rem;
    border-top: 1px solid var(--theme-divider-color);
  }
</style>
