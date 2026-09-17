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
  import { type Doc, type Ref, SortingOrder } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import ui, { ButtonIcon, IconAdd, Label, Section, showPopup } from '@hcengineering/ui'
  import { permissions } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'
  import { canCreateObjectDiscussion, canSeeObjectDiscussion } from '../../utils'
  import CreateObjectDiscussion from './CreateObjectDiscussion.svelte'
  import ObjectDiscussionRow from './ObjectDiscussionRow.svelte'

  export let doc: Doc
  export let readonly: boolean = false
  export let hidden: boolean = false

  const COLLAPSED_LIMIT = 3

  const dispatch = createEventDispatcher()
  const discussionsQuery = createQuery()
  const linkedQuery = createQuery()

  let discussions: ObjectDiscussion[] = []
  let linkedById = new Map<Ref<Doc>, Attachment>()
  let expanded = false

  $: discussionsQuery.query(
    chunter.class.ObjectDiscussion,
    { attachedTo: doc._id },
    (result) => {
      discussions = result.filter(canSeeObjectDiscussion).sort(compareDiscussions)
      dispatch('loaded')
    },
    { sort: { modifiedOn: SortingOrder.Descending } }
  )

  $: linkedIds = discussions.map((it) => it.linkedTo).filter((it): it is Ref<Doc> => it !== undefined)
  $: if (linkedIds.length > 0) {
    linkedQuery.query(attachment.class.Attachment, { _id: { $in: linkedIds as Array<Ref<Attachment>> } }, (result) => {
      linkedById = new Map(result.map((it) => [it._id, it]))
    })
  } else {
    linkedQuery.unsubscribe()
    linkedById = new Map()
  }

  $: canCreate = canCreateObjectDiscussion() && $permissions.canComment(doc)

  $: visibleDiscussions = expanded ? discussions : discussions.slice(0, COLLAPSED_LIMIT)

  function compareDiscussions (left: ObjectDiscussion, right: ObjectDiscussion): number {
    const leftResolved = left.status === ObjectDiscussionStatus.Resolved
    const rightResolved = right.status === ObjectDiscussionStatus.Resolved
    if (leftResolved !== rightResolved) {
      return leftResolved ? 1 : -1
    }
    return (right.modifiedOn ?? 0) - (left.modifiedOn ?? 0)
  }

  function createDiscussion (): void {
    showPopup(CreateObjectDiscussion, { object: doc }, 'top', (result?: Ref<ObjectDiscussion>) => {
      if (result != null) openDiscussion(result)
    })
  }

  // The owner panel shows the discussion in its aside, so it closes together with the object.
  function openDiscussion (discussionId: Ref<ObjectDiscussion>): void {
    dispatch('action', {
      id: 'aside',
      component: chunter.component.ObjectDiscussionAside,
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
              <button
                class="create-link over-underline text-sm caption-color"
                type="button"
                on:click={createDiscussion}
              >
                <Label label={chunter.string.NewDiscussion} />
              </button>
            {/if}
          </div>
        {:else}
          <div class="discussions mt-3">
            {#each visibleDiscussions as discussion (discussion._id)}
              <ObjectDiscussionRow
                {discussion}
                linked={discussion.linkedTo !== undefined ? linkedById.get(discussion.linkedTo) : undefined}
                on:open={(event) => {
                  openDiscussion(event.detail._id)
                }}
              />
            {/each}

            {#if discussions.length > COLLAPSED_LIMIT}
              <button class="footer" type="button" on:click={() => (expanded = !expanded)}>
                {#if expanded}
                  <Label label={ui.string.ShowLess} />
                {:else}
                  <Label label={chunter.string.ViewAllDiscussions} params={{ count: discussions.length }} />
                {/if}
              </button>
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

  .create-link {
    padding: 0;
    border: 0;
    background: transparent;
    font-family: inherit;
    cursor: pointer;
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 2.5rem;
    margin-top: -1px;
    border: 0;
    border-top: 1px solid var(--theme-divider-color);
    background: transparent;
    color: var(--theme-dark-color);
    font-family: inherit;
    font-size: 0.8125rem;
    cursor: pointer;

    &:hover {
      background: var(--global-ui-hover-highlight-BackgroundColor);
      color: var(--theme-caption-color);
    }
  }
</style>
