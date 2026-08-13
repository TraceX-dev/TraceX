<!--
//
// Copyright © 2026 Hardcore Engineering Inc.
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
  import { type Doc, type Ref } from '@hcengineering/core'
  import { Icon, IconCheck, Scroller, resizeObserver } from '@hcengineering/ui'
  import { type ReferenceVersion } from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'

  export let latest: Doc
  export let latestLabel: string
  export let versions: Promise<ReferenceVersion[]>
  export let selected: Ref<Doc> | undefined = undefined
  export let selectedObjects: Ref<Doc>[] = []
  export let multiSelect: boolean = false
  export let onSelect: (value: Doc | ReferenceVersion) => void

  const dispatch = createEventDispatcher()

  function select (value: Doc | ReferenceVersion): void {
    onSelect(value)
    dispatch('close')
  }

  function isSelected (value: Doc | ReferenceVersion): boolean {
    const id = '_id' in value ? value._id : value.id
    return selected === id || (multiSelect && selectedObjects.includes(id))
  }
</script>

<div class="selectPopup dropdown" use:resizeObserver={() => dispatch('changeContent')}>
  <div class="menu-space" />
  <Scroller>
    <button class="px-1 py-2 menu-item" on:click={() => { select(latest) }}>
      <div class="w-full flex-between">
        <div class="mr-2 ml-4 flex-row-center"><span class="title mr-1-5">{latestLabel}</span></div>
        {#if isSelected(latest)}
          <div class="check mr-2"><Icon icon={IconCheck} size={'small'} /></div>
        {/if}
      </div>
    </button>
    {#await versions then versionItems}
      {#if versionItems.length > 0}
        <div class="menu-separator" />
        {#each versionItems as version}
          <button class="px-1 py-2 menu-item" on:click={() => { select(version) }}>
            <div class="w-full flex-between">
              <div class="mr-2 ml-4 flex-row-center"><span class="title mr-1-5">{version.label}</span></div>
              {#if isSelected(version)}
                <div class="check mr-2"><Icon icon={IconCheck} size={'small'} /></div>
              {/if}
            </div>
          </button>
        {/each}
      {/if}
    {/await}
  </Scroller>
  <div class="menu-space" />
</div>

<style lang="scss">
  .dropdown {
    min-width: 25rem;
  }
  .title {
    white-space: nowrap;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
