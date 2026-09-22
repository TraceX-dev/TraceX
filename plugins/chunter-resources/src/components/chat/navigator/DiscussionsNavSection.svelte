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
  import { type Class, type Doc, type Ref, reduceCalls } from '@hcengineering/core'
  import { type DocNotifyContext } from '@hcengineering/notification'
  import { type IntlString, translate } from '@hcengineering/platform'
  import { createQuery, getClient, type LiveQuery } from '@hcengineering/presentation'
  import ui, { ModernButton, NavGroup } from '@hcengineering/ui'
  import { getDocTitle } from '@hcengineering/view-resources'
  import { createEventDispatcher, onDestroy } from 'svelte'

  import chunter from '../../../plugin'
  import { type ChatNavItemModel } from '../types'
  import ChatNavItem from './ChatNavItem.svelte'

  export let id: string
  export let header: IntlString
  export let objects: Doc[]
  export let contexts: DocNotifyContext[]
  export let selectedObject: Doc | undefined
  export let itemsCount: number

  interface DiscussionItem {
    discussion: Discussion
    context: DocNotifyContext | undefined
    model: ChatNavItemModel
    ownerId: Ref<Doc>
    ownerTitle: string
    unread: boolean
    lastActivity: number
  }

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const dispatcher = createEventDispatcher<{ 'show-more': void }>()
  const ownerQueries = new Map<Ref<Class<Doc>>, LiveQuery>()

  let items: DiscussionItem[] = []
  let visibleItems: DiscussionItem[] = []
  let collapsedSectionItems: DiscussionItem[] = []
  let ownerObjectsByClass = new Map<Ref<Class<Doc>>, Doc[]>()
  let canShowMore = false

  $: loadOwners(objects as Discussion[])

  $: void buildItems(objects, contexts, ownerObjectsByClass, (result) => {
    items = result
  })

  $: visibleItems = [...items].sort((left, right) => compareDiscussionItems(left, right, selectedObject))

  $: collapsedSectionItems = visibleItems.filter((item) => item.unread || item.discussion._id === selectedObject?._id)
  $: canShowMore = itemsCount > items.length

  onDestroy(() => {
    for (const query of ownerQueries.values()) {
      query.unsubscribe()
    }
  })

  function loadOwners (discussions: Discussion[]): void {
    const ownerIdsByClass = new Map<Ref<Class<Doc>>, Set<Ref<Doc>>>()

    for (const discussion of discussions) {
      if (!hierarchy.hasClass(discussion.attachedToClass)) continue

      const ids = ownerIdsByClass.get(discussion.attachedToClass) ?? new Set<Ref<Doc>>()
      ids.add(discussion.attachedTo)
      ownerIdsByClass.set(discussion.attachedToClass, ids)
    }

    for (const [ownerClass, ownerIds] of ownerIdsByClass) {
      const query = ownerQueries.get(ownerClass) ?? createQuery(true)
      ownerQueries.set(ownerClass, query)

      query.query(ownerClass, { _id: { $in: Array.from(ownerIds) } }, (result) => {
        ownerObjectsByClass = new Map(ownerObjectsByClass).set(ownerClass, result)
      })
    }

    for (const [ownerClass, query] of ownerQueries) {
      if (ownerIdsByClass.has(ownerClass)) continue

      query.unsubscribe()
      ownerQueries.delete(ownerClass)
      const nextOwnerObjects = new Map(ownerObjectsByClass)
      nextOwnerObjects.delete(ownerClass)
      ownerObjectsByClass = nextOwnerObjects
    }
  }

  const buildItems = reduceCalls(
    async (
      objects: Doc[],
      contexts: DocNotifyContext[],
      ownerObjectsByClass: Map<Ref<Class<Doc>>, Doc[]>,
      handler: (result: DiscussionItem[]) => void
    ): Promise<void> => {
      const contextByObject = new Map(contexts.map((context) => [context.objectId, context]))
      const discussions = objects as Discussion[]
      const ownerDiscussions = new Map<string, Discussion>()
      const ownerObjects = new Map<string, Doc>()
      const ownerTitles = new Map<string, string>()

      for (const [ownerClass, objects] of ownerObjectsByClass) {
        for (const object of objects) {
          ownerObjects.set(getOwnerKey(object._id, ownerClass), object)
        }
      }

      for (const discussion of discussions) {
        ownerDiscussions.set(getOwnerKey(discussion.attachedTo, discussion.attachedToClass), discussion)
      }

      await Promise.all(
        Array.from(ownerDiscussions.values()).map(async (discussion) => {
          const key = getOwnerKey(discussion.attachedTo, discussion.attachedToClass)
          const hasOwnerClass = hierarchy.hasClass(discussion.attachedToClass)
          const owner = ownerObjects.get(key)
          const ownerClass = hasOwnerClass ? hierarchy.getClass(discussion.attachedToClass) : undefined
          const title =
            (owner !== undefined
              ? await getDocTitle(client, discussion.attachedTo, discussion.attachedToClass, owner)
              : undefined) ?? (ownerClass !== undefined ? await translate(ownerClass.label, {}) : '')

          ownerTitles.set(key, title)
        })
      )

      handler(
        discussions.map((discussion) => {
          const context = contextByObject.get(discussion._id)

          return {
            discussion,
            context,
            ownerId: discussion.attachedTo,
            ownerTitle: ownerTitles.get(getOwnerKey(discussion.attachedTo, discussion.attachedToClass)) ?? '',
            unread: isUnread(context),
            lastActivity: Math.max(context?.lastUpdateTimestamp ?? 0, discussion.modifiedOn ?? 0),
            model: {
              id: discussion._id,
              object: discussion,
              title: discussion.name,
              icon: chunter.icon.Thread,
              iconProps: {},
              iconSize: 'small',
              withIconBackground: true
            }
          }
        })
      )
    }
  )

  function getOwnerKey (ownerId: Ref<Doc>, ownerClass: Ref<Class<Doc>>): string {
    return `${ownerClass}:${ownerId}`
  }

  function isUnread (context: DocNotifyContext | undefined): boolean {
    return (context?.lastUpdateTimestamp ?? 0) > (context?.lastViewedTimestamp ?? 0)
  }

  function compareDiscussionItems (
    left: DiscussionItem,
    right: DiscussionItem,
    selectedObject: Doc | undefined
  ): number {
    const leftSelected = left.ownerId === selectedObject?._id || left.discussion._id === selectedObject?._id
    const rightSelected = right.ownerId === selectedObject?._id || right.discussion._id === selectedObject?._id

    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1
    if (left.unread !== right.unread) return left.unread ? -1 : 1
    return right.lastActivity - left.lastActivity
  }

  function showMore (): void {
    dispatcher('show-more')
  }
</script>

<NavGroup
  _id={id}
  label={header}
  categoryName={id}
  highlighted={items.some(
    ({ discussion, ownerId }) => discussion._id === selectedObject?._id || ownerId === selectedObject?._id
  )}
  isFold
  empty={visibleItems.length === 0}
  visible={collapsedSectionItems.length > 0}
  noDivider
>
  {#each visibleItems as item (item.discussion._id)}
    <ChatNavItem
      context={item.context}
      isSelected={item.discussion._id === selectedObject?._id}
      item={item.model}
      type="type-object"
      on:select
    >
      <span class="flat-title overflow-label">
        <span>{item.discussion.name}</span>
        {#if item.ownerTitle !== ''}
          <span class="owner-title"> · {item.ownerTitle}</span>
        {/if}
      </span>
    </ChatNavItem>
  {/each}

  {#if canShowMore}
    <div class="show-more">
      <ModernButton label={ui.string.ShowMore} kind="tertiary" inheritFont size="extra-small" on:click={showMore} />
    </div>
  {/if}

  <svelte:fragment slot="visible">
    {#each collapsedSectionItems as item (item.discussion._id)}
      <ChatNavItem
        context={item.context}
        isSelected={item.discussion._id === selectedObject?._id}
        item={item.model}
        type="type-object"
        on:select
      >
        <span class="flat-title overflow-label">
          <span>{item.discussion.name}</span>
          {#if item.ownerTitle !== ''}
            <span class="owner-title"> · {item.ownerTitle}</span>
          {/if}
        </span>
      </ChatNavItem>
    {/each}
  </svelte:fragment>
</NavGroup>

<style lang="scss">
  .flat-title {
    min-width: 0;
    color: var(--global-primary-TextColor);
    font-size: 0.875rem;
    font-weight: 400;
  }

  .owner-title {
    color: var(--global-secondary-TextColor);
  }

  .show-more {
    margin: var(--spacing-1);
    font-size: 0.75rem;
  }
</style>
