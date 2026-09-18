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
  import { type Class, type Doc, type Ref, type SortingQuery } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import presentation, { Card } from '@hcengineering/presentation'
  import { createEventDispatcher } from 'svelte'
  import FunctionSortEditor from '../transformEditors/FunctionSortEditor.svelte'

  export let _class: Ref<Class<Doc>>
  export let label: string
  export let sort: SortingQuery<Doc> | undefined = undefined

  const dispatch = createEventDispatcher()

  function save (): void {
    dispatch('close', { sort })
  }
</script>

<Card
  on:close
  width={'small'}
  label={getEmbeddedLabel(label)}
  canSave
  okAction={save}
  okLabel={presentation.string.Save}
>
  <FunctionSortEditor {_class} bind:sort />
</Card>
