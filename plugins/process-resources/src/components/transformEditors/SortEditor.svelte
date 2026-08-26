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
  import { type AnyAttribute, type Doc, type SortingQuery } from '@hcengineering/core'
  import presentation, { Card, getAttributePresenterClass, getClient } from '@hcengineering/presentation'
  import { type Process, type ProcessFunction } from '@hcengineering/process'
  import { createEventDispatcher } from 'svelte'
  import FunctionSortEditor from './FunctionSortEditor.svelte'

  export let func: ProcessFunction
  export let process: Process
  export let attribute: AnyAttribute
  export let props: Record<string, any> = {}

  const dispatch = createEventDispatcher()
  const hierarchy = getClient().getHierarchy()
  const presenterClass = getAttributePresenterClass(hierarchy, attribute.type)

  let sort = props.$sort as SortingQuery<Doc> | undefined

  function save (): void {
    dispatch('close', {
      _class: presenterClass.attrClass,
      ...(sort == null ? {} : { $sort: sort })
    })
  }
</script>

<Card on:close width={'small'} label={func.label} canSave okAction={save} okLabel={presentation.string.Save}>
  <FunctionSortEditor _class={presenterClass.attrClass} bind:sort />
</Card>
