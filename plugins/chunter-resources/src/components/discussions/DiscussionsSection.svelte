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
  import { type DefaultDiscussion, type Discussion } from '@hcengineering/chunter'
  import { type Doc, type Ref, SortingOrder } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import ui, { Button, ButtonIcon, IconAdd, Label, Section, showPopup } from '@hcengineering/ui'
  import { permissions } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'
  import { canCreateDiscussion, getOrCreateDefaultDiscussion } from '../../utils'
  import CreateDiscussion from './CreateDiscussion.svelte'
  import DefaultDiscussionRow from './DefaultDiscussionRow.svelte'
  import DiscussionRow from './DiscussionRow.svelte'

  export let doc: Doc
  export let readonly: boolean = false
  export let hidden: boolean = false

  const COLLAPSED_LIMIT = 3

  const dispatch = createEventDispatcher()
  const discussionsQuery = createQuery()
  const defaultDiscussionsQuery = createQuery()

  let discussions: Discussion[] = []
  let loadedFor: Ref<Doc> | undefined = undefined
  let defaultDiscussions: DefaultDiscussion[] = []
  let creatingDefault: Ref<DefaultDiscussion> | undefined = undefined
  let expanded = false

  // Default discussions are configured on the owner type, without inheritance.
  $: defaultDiscussionsQuery.query(chunter.class.DefaultDiscussion, { ofClass: doc._class }, (result) => {
    defaultDiscussions = result
  })

  $: discussionsQuery.query(
    chunter.class.Discussion,
    { attachedTo: doc._id },
    (result) => {
      discussions = result
      loadedFor = doc._id
      dispatch('loaded')
    },
    { sort: { modifiedOn: SortingOrder.Descending } }
  )

  $: canCreate = canCreateDiscussion() && $permissions.canComment(doc)

  // Default discussions go first, in the configured order.
  $: defaultOrder = new Map(defaultDiscussions.map((it, index) => [it._id, index]))
  $: sortedDiscussions = [...discussions].sort(compareDiscussions)

  // A default discussion is created lazily, so until then it is shown as a placeholder row.
  $: placeholders =
    loadedFor === doc._id && !readonly && canCreate
      ? defaultDiscussions.filter((config) => !discussions.some((it) => it.defaultDiscussion === config._id))
      : []

  $: collapsedLimit = Math.max(COLLAPSED_LIMIT - placeholders.length, 0)
  $: visibleDiscussions = expanded ? sortedDiscussions : sortedDiscussions.slice(0, collapsedLimit)

  function getDefaultOrder (discussion: Discussion): number {
    const config = discussion.defaultDiscussion
    const order = config !== undefined ? defaultOrder.get(config) : undefined
    return order ?? Number.MAX_SAFE_INTEGER
  }

  function compareDiscussions (left: Discussion, right: Discussion): number {
    const order = getDefaultOrder(left) - getDefaultOrder(right)
    if (order !== 0) return order
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

  async function openDefaultDiscussion (config: DefaultDiscussion): Promise<void> {
    if (creatingDefault !== undefined) return
    creatingDefault = config._id
    try {
      const discussionId = await getOrCreateDefaultDiscussion(doc, config)
      if (discussionId !== undefined) openDiscussion(discussionId)
    } finally {
      creatingDefault = undefined
    }
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
        {#if discussions.length === 0 && placeholders.length === 0}
          <div class="antiSection-empty flex-col mt-3">
            <span class="text-sm content-dark-color"><Label label={chunter.string.NoDiscussionsYet} /></span>
            {#if !readonly && canCreate}
              <Button kind="link" size="small" label={chunter.string.NewDiscussion} on:click={createDiscussion} />
            {/if}
          </div>
        {:else}
          <div class="discussions mt-3">
            {#each placeholders as config (config._id)}
              <DefaultDiscussionRow
                name={config.name}
                loading={creatingDefault === config._id}
                on:open={() => void openDefaultDiscussion(config)}
              />
            {/each}
            {#each visibleDiscussions as discussion (discussion._id)}
              <DiscussionRow
                {discussion}
                on:open={(event) => {
                  openDiscussion(event.detail._id)
                }}
              />
            {/each}

            {#if discussions.length > collapsedLimit}
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

  // The last row above already draws the divider.
  .footer {
    padding: 0.25rem;
  }
</style>
