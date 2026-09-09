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
  import { type MasterTag, type Tag } from '@hcengineering/card'
  import core, { type AnyAttribute, type Association, type Class, type Doc, type Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { type ProcessFunction, type SelectedContext } from '@hcengineering/process'
  import { eventToHTMLElement, Label, resizeObserver, Scroller, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import plugin from '../../plugin'
  import { getContextFunctionReduce } from '../../utils'
  import RelationTableConfigPopup from './RelationTableConfigPopup.svelte'

  export let context: ProcessFunction
  export let masterTag: Ref<MasterTag | Tag>
  export let target: AnyAttribute
  export let onSelect: (val: SelectedContext) => void

  const dispatch = createEventDispatcher()
  const client = getClient()

  interface RelationItem {
    _id: string
    label: string
    targetClass: Ref<Class<Doc>>
    association: Ref<Association>
    direction: 'A' | 'B'
  }

  const ancestors = client.getHierarchy().getAncestors(masterTag)
  const leftAssociations = client.getModel().findAllSync(core.class.Association, { classA: { $in: ancestors } })
  const rightAssociations = client.getModel().findAllSync(core.class.Association, { classB: { $in: ancestors } })

  const items: RelationItem[] = []
  rightAssociations.forEach((a) => {
    if (a.nameA) {
      items.push({
        _id: 'A_' + a._id,
        label: a.nameA,
        targetClass: a.classA,
        association: a._id,
        direction: 'A'
      })
    }
  })
  leftAssociations.forEach((a) => {
    if (a.nameB) {
      items.push({
        _id: 'B_' + a._id,
        label: a.nameB,
        targetClass: a.classB,
        association: a._id,
        direction: 'B'
      })
    }
  })

  items.sort((a, b) => a.label.localeCompare(b.label))

  const elements: HTMLButtonElement[] = []

  const keyDown = (event: KeyboardEvent, index: number): void => {
    if (event.key === 'ArrowDown') {
      elements[(index + 1) % elements.length]?.focus()
    }

    if (event.key === 'ArrowUp') {
      elements[(elements.length + index - 1) % elements.length]?.focus()
    }

    if (event.key === 'ArrowLeft') {
      dispatch('close')
    }
  }

  function onValue (e: MouseEvent, item: RelationItem): void {
    showPopup(
      RelationTableConfigPopup,
      {
        _class: item.targetClass,
        label: item.label
      },
      eventToHTMLElement(e),
      (res) => {
        if (res != null) {
          const pathReduce = getContextFunctionReduce(context, target)
          onSelect({
            type: 'function',
            func: context._id,
            key: target.name,
            functions: [],
            sourceFunction: pathReduce,
            props: {
              association: item.association,
              direction: item.direction,
              name: item.label,
              targetClass: item.targetClass,
              ...(res.sort == null ? {} : { $sort: res.sort })
            }
          })
          dispatch('close')
        }
      }
    )
  }
</script>

<div class="selectPopup" use:resizeObserver={() => dispatch('changeContent')}>
  <div class="menu-space" />
  <Scroller>
    {#if items.length === 0}
      <div class="menu-item disabled">
        <span class="overflow-label pr-1">
          <Label label={plugin.string.EmptyValue} />
        </span>
      </div>
    {:else}
      {#each items as item, i}
        <!-- svelte-ignore a11y-mouse-events-have-key-events -->
        <button
          bind:this={elements[i]}
          on:keydown={(event) => {
            keyDown(event, i)
          }}
          on:mouseover={() => {
            elements[i]?.focus()
          }}
          on:click={(e) => {
            onValue(e, item)
          }}
          class="menu-item"
        >
          <span class="overflow-label pr-1">
            {item.label}
          </span>
        </button>
      {/each}
    {/if}
  </Scroller>
  <div class="menu-space" />
</div>
