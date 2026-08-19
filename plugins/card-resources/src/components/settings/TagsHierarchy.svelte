<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import cardPlugin, { MasterTag, Tag } from '@hcengineering/card'
  import core, { Class, ClassifierKind, Doc, Ref, toRank } from '@hcengineering/core'
  import { IconWithEmoji, createQuery, getClient } from '@hcengineering/presentation'
  import { Icon, Label } from '@hcengineering/ui'
  import { makeRank } from '@hcengineering/rank'
  import { SortableList } from '@hcengineering/view-resources'
  import view from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'

  interface TagItem {
    _id: Ref<Tag>
    tag: Tag
  }

  export let classes: Array<TagItem | Ref<Tag>> = []
  export let _class: Ref<Class<Doc>> | undefined
  export let kind: ClassifierKind = ClassifierKind.CLASS
  export let level: number = 0

  const client = getClient()
  const dispatch = createEventDispatcher()
  let descendants = new Map<Ref<Tag>, TagItem[]>()
  let normalizedClasses: TagItem[] = []

  function normalizeTagItems (items: Array<TagItem | Ref<Tag>>): TagItem[] {
    const hierarchy = client.getHierarchy()
    return items.map((item) => {
      if (typeof item === 'string') {
        return { _id: item, tag: hierarchy.getClass(item) as Tag }
      }
      return item
    })
  }

  function getDescendants (_class: Ref<Tag>): TagItem[] {
    const hierarchy = client.getHierarchy()
    const result: TagItem[] = []
    const desc = hierarchy.getDescendants(_class)
    for (const clazz of desc) {
      const cls = hierarchy.getClass(clazz)
      if (
        cls.extends === _class &&
        !cls.hidden &&
        kind === cls.kind &&
        cls.label !== undefined &&
        (cls as MasterTag).removed !== true
      ) {
        result.push({ _id: clazz as Ref<Tag>, tag: cls as Tag })
      }
    }
    return result.sort((a, b) => {
      return (a.tag.rank ?? toRank(a._id) ?? '').localeCompare(b.tag.rank ?? toRank(b._id) ?? '')
    })
  }

  function fillDescendants (classes: TagItem[]): void {
    for (const cl of classes) {
      descendants.set(cl._id, getDescendants(cl._id))
    }
    descendants = descendants
  }

  const query = createQuery()
  query.query(core.class.Class, {}, () => {
    fillDescendants(normalizedClasses)
  })

  $: normalizedClasses = normalizeTagItems(classes)
  $: fillDescendants(normalizedClasses)

  async function moveHandler (event: CustomEvent<{ item: TagItem, prev?: TagItem, next?: TagItem }>): Promise<void> {
    const { item, prev, next } = event.detail
    await client.update(item.tag, {
      rank: makeRank(prev?.tag.rank ?? toRank(prev?._id), next?.tag.rank ?? toRank(next?._id))
    })
  }
</script>

<SortableList items={normalizedClasses} on:move={moveHandler}>
  <svelte:fragment slot="object" let:value={cl}>
    <button
      class="hulyTableAttr-content__row justify-start cursor-pointer"
      on:click={() => {
        dispatch('select', cl._id)
      }}
    >
      <div
        class="hulyTableAttr-content__row-label font-medium-14 flex flex-gap-2"
        style:margin-left={`${level * 1.25}rem`}
      >
        <Icon
          icon={cl.tag.icon === view.ids.IconWithEmoji ? IconWithEmoji : (cl.tag.icon ?? cardPlugin.icon.Tag)}
          iconProps={cl.tag.icon === view.ids.IconWithEmoji ? { icon: cl.tag.color, size: 'small' } : {}}
          size="small"
        />
        <Label label={cl.tag.label} />
      </div>
    </button>
    {#if (descendants.get(cl._id)?.length ?? 0) > 0}
      <svelte:self classes={descendants.get(cl._id) ?? []} {_class} {kind} level={level + 1} on:select />
    {/if}
  </svelte:fragment>
</SortableList>
