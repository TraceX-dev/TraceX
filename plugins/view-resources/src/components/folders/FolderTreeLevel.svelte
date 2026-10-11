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
  import { createEventDispatcher, onMount } from 'svelte'
  import { Analytics } from '@hcengineering/analytics'
  import contact from '@hcengineering/contact'
  import type { PermissionsStore } from '@hcengineering/contact'
  import type { Readable } from 'svelte/store'
  import { makeRank } from '@hcengineering/task'
  import type { DocWithRank } from '@hcengineering/task'
  import { canChangeAttribute } from '../../permissions'
  import { restrictionStore } from '../../utils'
  import { getClient } from '@hcengineering/presentation'
  import { Doc, Ref, TypedSpace } from '@hcengineering/core'
  import { Action, IconEdit } from '@hcengineering/ui'
  import { getResource } from '@hcengineering/platform'

  import { TreeItem, getActions as getContributedActions } from '../../index'

  export let folders: Ref<Doc>[]
  export let folderById: Map<Ref<Doc>, Doc>
  export let descendants: Map<Ref<Doc>, Doc[]>

  export let selected: Ref<Doc> | undefined
  export let level: number = 0
  export let once: boolean = false
  export let readonly: boolean = false
  export let reorderable: boolean = false

  const dispatch = createEventDispatcher()

  const client = getClient()

  let permissionsStore: Readable<PermissionsStore> | undefined
  let dragged: Doc | undefined
  let dropTarget: Ref<Doc> | undefined
  let dropAfter = false
  let savingRank = false

  onMount(() => {
    void getResource(contact.store.Permissions)
      .then((store) => {
        permissionsStore = store
      })
      .catch((error) => {
        Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
      })
  })

  function canReorder (doc: Doc, permissions: PermissionsStore | undefined): boolean {
    if (!reorderable || readonly || $restrictionStore.readonly || savingRank || permissions === undefined) return false
    const attribute = client.getHierarchy().getAllAttributes(doc._class).get('rank')
    return (
      attribute !== undefined &&
      attribute.readonly !== true &&
      canChangeAttribute(attribute, doc.space as Ref<TypedSpace>, permissions, doc._class)
    )
  }

  function resetDrag (): void {
    dragged = undefined
    dropTarget = undefined
    dropAfter = false
  }

  function startDrag (event: DragEvent, doc: Doc): void {
    if (!canReorder(doc, $permissionsStore)) {
      event.preventDefault()
      return
    }
    event.stopPropagation()
    dragged = doc
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', doc._id)
    }
  }

  function dragOver (event: DragEvent, doc: Doc): void {
    if (dragged === undefined || !canReorder(dragged, $permissionsStore)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    dropTarget = doc._id
    dropAfter = event.clientY > rect.top + rect.height / 2
  }

  async function drop (event: DragEvent, target: Doc): Promise<void> {
    const doc = dragged
    if (doc === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const after = dropAfter
    resetDrag()
    if (!canReorder(doc, $permissionsStore) || doc._id === target._id) return
    const originalIndex = _folders.findIndex((item) => item._id === doc._id)
    const remaining = _folders.filter((item) => item._id !== doc._id)
    const targetIndex = remaining.findIndex((item) => item._id === target._id)
    if (originalIndex === -1 || targetIndex === -1) return
    const index = targetIndex + (after ? 1 : 0)
    if (index === originalIndex) return
    try {
      savingRank = true
      const prev = remaining[index - 1] as DocWithRank | undefined
      const next = remaining[index] as DocWithRank | undefined
      const rank = makeRank(prev?.rank, next?.rank)
      await client.update(doc as DocWithRank, { rank })
    } catch (error) {
      Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      savingRank = false
    }
  }

  function getTitle (doc: Doc): string {
    return (doc as any)?.title || ''
  }

  function getDescendants (obj: Ref<Doc>): Ref<Doc>[] {
    return (descendants.get(obj) ?? []).sort((a, b) => getTitle(a).localeCompare(getTitle(b))).map((p) => p._id)
  }

  function handleSelected (obj: Ref<Doc>): void {
    dispatch('selected', obj)
  }

  async function getActions (obj: Doc): Promise<Action[]> {
    const result: Action[] = []
    const extraActions = await getContributedActions(client, obj)
    for (const act of extraActions) {
      result.push({
        icon: act.icon ?? IconEdit,
        label: act.label,
        action: async (ctx: any, evt: Event) => {
          const impl = await getResource(act.action)
          await impl(obj, evt, act.actionProps)
        }
      })
    }
    return result
  }

  function sortFolders (docs: Doc[], byRank: boolean): Doc[] {
    if (!byRank) return docs
    return docs.sort((a, b) => {
      const left = (a as DocWithRank).rank ?? ''
      const right = (b as DocWithRank).rank ?? ''
      return left < right ? -1 : left > right ? 1 : 0
    })
  }
  $: _folders = sortFolders(
    folders.map((it) => folderById.get(it)).filter((it) => it !== undefined),
    reorderable
  )
  $: _descendants = new Map(_folders.map((it) => [it._id, getDescendants(it._id)]))
</script>

{#each _folders as doc (doc._id)}
  {@const desc = _descendants.get(doc._id) ?? []}

  {#if doc}
    <div
      class:dragging={dragged?._id === doc._id}
      class:drop-before={dropTarget === doc._id && !dropAfter}
      class:drop-after={dropTarget === doc._id && dropAfter}
    >
      <TreeItem
        _id={doc._id}
        folderIcon
        title={getTitle(doc)}
        selected={selected === doc._id}
        isFold
        empty={desc.length === 0}
        actions={async () => await getActions(doc)}
        {level}
        shouldTooltip
        draggable={canReorder(doc, $permissionsStore)}
        on:dragstart={(event) => startDrag(event, doc)}
        on:dragover={(event) => dragOver(event, doc)}
        on:dragend={resetDrag}
        on:drop={(event) => {
          void drop(event, doc)
        }}
        on:click={() => {
          handleSelected(doc._id)
        }}
      >
        <svelte:fragment slot="dropbox">
          {#if desc.length > 0 && !once}
            <svelte:self folders={desc} {descendants} {folderById} {selected} level={level + 1} on:selected />
          {/if}
        </svelte:fragment>
      </TreeItem>
    </div>
  {/if}
{/each}

<style lang="scss">
  .dragging {
    opacity: 0.5;
  }

  .drop-before {
    box-shadow: inset 0 2px 0 var(--primary-button-default);
  }

  .drop-after {
    box-shadow: inset 0 -2px 0 var(--primary-button-default);
  }
</style>
