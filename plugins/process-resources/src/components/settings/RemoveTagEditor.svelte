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
//

-->
<script lang="ts">
  import type { Tag } from '@hcengineering/card'
  import type { Ref } from '@hcengineering/core'
  import type { Process, Step } from '@hcengineering/process'
  import { createEventDispatcher } from 'svelte'
  import TagSelector from './TagSelector.svelte'

  export let process: Process
  export let step: Step<Tag>

  const dispatch = createEventDispatcher<{ change: Step<Tag> }>()

  function changeTag (event: CustomEvent<{ tag: Ref<Tag> }>): void {
    step.params = { ...step.params, _id: event.detail.tag }
    dispatch('change', step)
  }
</script>

<TagSelector {process} tag={step.params._id} on:change={changeTag} />
