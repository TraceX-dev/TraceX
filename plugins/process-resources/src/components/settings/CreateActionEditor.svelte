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
  import { type EventButton, type MethodParams, type Process, type Step } from '@hcengineering/process'
  import { createEventDispatcher } from 'svelte'
  import plugin from '../../plugin'
  import ParamsEditor from './ParamsEditor.svelte'

  export let process: Process
  export let step: Step<EventButton>

  const dispatch = createEventDispatcher()
  const keys = ['title', 'description', 'eventType', 'user']

  function changeParams (event: CustomEvent<MethodParams<EventButton>>): void {
    step.params = event.detail
    dispatch('change', step)
  }
</script>

<ParamsEditor _class={plugin.class.EventButton} {process} {keys} params={step.params} on:change={changeParams} />
