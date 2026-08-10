<!--
//
// Copyright © 2023 Hardcore Engineering Inc.
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
  import { type ControlledDocument, type DocumentMeta } from '@hcengineering/controlled-documents'
  import { type Ref, SortingOrder } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { Label, Scroller } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import documents from '../../plugin'
  import DocumentVersionsPopupItem from '../DocumentVersionsPopupItem.svelte'

  export let meta: Ref<DocumentMeta>
  export let selected: Ref<ControlledDocument> | undefined = undefined

  const dispatch = createEventDispatcher<{ close: Ref<ControlledDocument> }>()
  const query = createQuery()

  let versions: ControlledDocument[] = []

  $: query.query(
    documents.class.ControlledDocument,
    { attachedTo: meta },
    (result) => {
      versions = result
    },
    { sort: { major: SortingOrder.Descending, minor: SortingOrder.Descending } }
  )
</script>

<div class="selectPopup dropdown">
  <div class="menu-space" />
  <Scroller>
    {#if versions[0] !== undefined}
      <button class="px-1 py-2 menu-item" on:click={() => dispatch('close', versions[0]._id)}>
        <div class="w-full flex-between">
          <div class="mr-2 ml-4 flex-row-center">
            <span class="title mr-1-5">{versions[0].title}</span>
            <span class="latest mr-1-5"><Label label={documents.string.LatestVersionHint} /></span>
          </div>
        </div>
      </button>
      <div class="menu-separator" />
    {/if}
    {#each versions as version}
      <DocumentVersionsPopupItem
        doc={version}
        isCurrent={version._id === selected}
        onClick={() => dispatch('close', version._id)}
      />
    {/each}
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

  .latest {
    font-weight: 500;
    opacity: 0.6;
  }
</style>
