<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import contact from '@hcengineering/contact'
  import { statusByUserStore } from '@hcengineering/contact-resources'
  import { type Discussion } from '@hcengineering/chunter'
  import { Doc, groupByArray, reduceCalls, Ref } from '@hcengineering/core'
  import { DocNotifyContext } from '@hcengineering/notification'
  import { getResource, IntlString, translate } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import ui, { Action, IconSize, ModernButton, NavGroup } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { getDocTitle } from '@hcengineering/view-resources'

  import { createEventDispatcher } from 'svelte'
  import chunter from '../../../plugin'
  import { getChannelName, getObjectIcon } from '../../../utils'
  import { ChatNavItemModel, SortFnOptions } from '../types'
  import ChatNavItem from './ChatNavItem.svelte'

  export let id: string
  export let header: IntlString
  export let objects: Doc[]
  export let itemsCount: number
  export let contexts: DocNotifyContext[]
  export let actions: Action[] = []
  export let objectId: Ref<Doc> | undefined
  export let sortFn: (items: ChatNavItemModel[], options: SortFnOptions) => ChatNavItemModel[]
  export let showUnreadWhenCollapsed = false

  const client = getClient()
  const hierarchy = client.getHierarchy()

  let sortedItems: ChatNavItemModel[] = []
  let items: ChatNavItemModel[] = []

  const dispatcher = createEventDispatcher()

  let canShowMore = false

  $: void getChatNavItems(objects, (res) => {
    items = res
  })

  $: sortedItems = sortFn(items, {
    contexts,
    userStatusByAccount: $statusByUserStore
  })
  $: canShowMore = itemsCount > items.length

  // Discussions are shown as "Name · Parent", where the parent is the object the discussion is attached to.
  // Parents are loaded in one query per class instead of one request per discussion.
  async function getDiscussionParentTitles (objects: Doc[]): Promise<Map<Ref<Doc>, string>> {
    const discussions = objects.filter((it): it is Discussion =>
      hierarchy.isDerived(it._class, chunter.class.Discussion)
    )
    const byParentClass = groupByArray(
      discussions.filter((it) => hierarchy.hasClass(it.attachedToClass)),
      (it) => it.attachedToClass
    )

    const parents = (
      await Promise.all(
        Array.from(byParentClass.entries()).map(
          async ([_class, docs]) => await client.findAll(_class, { _id: { $in: docs.map((it) => it.attachedTo) } })
        )
      )
    ).flat()

    const titles = new Map<Ref<Doc>, string>()
    await Promise.all(
      parents.map(async (parent) => {
        const title = await getDocTitle(client, parent._id, parent._class, parent)
        if (title !== undefined && title !== '') titles.set(parent._id, title)
      })
    )

    const result = new Map<Ref<Doc>, string>()
    for (const discussion of discussions) {
      const title = titles.get(discussion.attachedTo)
      if (title !== undefined) result.set(discussion._id, title)
    }
    return result
  }

  async function getChatNavItem (object: Doc, parentTitles: Map<Ref<Doc>, string>): Promise<ChatNavItemModel> {
    const { _class } = object
    const iconMixin = hierarchy.classHierarchyMixin(_class, view.mixin.ObjectIcon)
    const titleIntl = hierarchy.getClass(_class).label

    const isPerson = hierarchy.isDerived(_class, contact.class.Person)
    const isDocChat = !hierarchy.isDerived(_class, chunter.class.ChunterSpace)
    const isDirect = hierarchy.isDerived(_class, chunter.class.DirectMessage)
    const isDiscussion = hierarchy.isDerived(_class, chunter.class.Discussion)

    const iconSize: IconSize = isDirect || isPerson ? 'x-small' : 'small'

    const hasId = hierarchy.classHierarchyMixin(_class, view.mixin.ObjectIdentifier) !== undefined
    const showDescription = hasId && isDocChat && !isPerson && !isDiscussion

    const [icon, title, description] = await Promise.all([
      iconMixin?.component !== undefined ? getResource(iconMixin.component) : undefined,
      isDiscussion ? getDocTitle(client, object._id, _class, object) : getChannelName(object._id, _class, object),
      showDescription ? getDocTitle(client, object._id, _class, object) : undefined
    ])

    return {
      id: object._id,
      object,
      title: title ?? (await translate(titleIntl, {})),
      secondaryTitle: isDiscussion ? parentTitles.get(object._id) : undefined,
      description,
      icon: icon ?? getObjectIcon(_class),
      iconProps: { showStatus: true },
      iconSize,
      withIconBackground: !isDirect && !isPerson
    }
  }

  const getChatNavItems = reduceCalls(
    async (objects: Doc[], handler: (items: ChatNavItemModel[]) => void): Promise<void> => {
      const parentTitles = await getDiscussionParentTitles(objects)
      const items = await Promise.all(objects.map(async (object) => await getChatNavItem(object, parentTitles)))

      handler(items)
    }
  )

  function onShowMore (): void {
    dispatcher('show-more')
  }

  function isUnread (context: DocNotifyContext | undefined): boolean {
    return (context?.lastUpdateTimestamp ?? 0) > (context?.lastViewedTimestamp ?? 0)
  }

  // Items that stay visible when the section is collapsed: the selected one and, optionally, unread ones.
  $: collapsedItems = sortedItems.filter(
    ({ id }) =>
      id === objectId ||
      (showUnreadWhenCollapsed && isUnread(contexts.find(({ objectId: ctxObjectId }) => ctxObjectId === id)))
  )
</script>

{#if sortedItems.length > 0 && contexts.length > 0}
  <NavGroup
    _id={id}
    label={header}
    categoryName={id}
    {actions}
    highlighted={items.some((it) => it.id === objectId)}
    isFold
    empty={sortedItems.length === 0}
    visible={collapsedItems.length > 0}
    noDivider
  >
    {#each sortedItems as item (item.id)}
      {@const context = contexts.find(({ objectId }) => objectId === item.id)}
      <ChatNavItem {context} isSelected={objectId === item.id} {item} type="type-object" on:select />
    {/each}
    {#if canShowMore}
      <div class="showMore">
        <ModernButton label={ui.string.ShowMore} kind="tertiary" inheritFont size="extra-small" on:click={onShowMore} />
      </div>
    {/if}
    <svelte:fragment slot="visible" let:isOpen>
      {#if !isOpen}
        {#each collapsedItems as item (item.id)}
          {@const context = contexts.find(({ objectId }) => objectId === item.id)}
          <ChatNavItem {context} isSelected={objectId === item.id} {item} type="type-object" on:select />
        {/each}
      {/if}
    </svelte:fragment>
  </NavGroup>
{/if}

<style lang="scss">
  .showMore {
    margin: var(--spacing-1);
    font-size: 0.75rem;
  }
</style>
