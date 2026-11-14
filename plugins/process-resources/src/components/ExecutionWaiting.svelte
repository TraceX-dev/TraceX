<!--
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { SortingOrder, type Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import type { IntlString } from '@hcengineering/platform'
  import { ExecutionStatus, type Execution, type TransitionDiagnostic } from '@hcengineering/process'
  import { DateTimePresenter, Label } from '@hcengineering/ui'
  import plugin from '../plugin'
  import ErrorTooltip from './ErrorTooltip.svelte'
  import ExecutionReason from './ExecutionReason.svelte'
  import TransitionPresenter from './settings/TransitionPresenter.svelte'
  import TriggerPresenter from './settings/TriggerPresenter.svelte'

  export let execution: Execution
  export let path: Ref<Execution>[] = []

  const model = getClient().getModel()
  $: definition = model.findObject(execution.process)
  $: transitions = model.findAllSync(
    plugin.class.Transition,
    {
      process: execution.process,
      from: execution.currentState
    },
    { sort: { rank: SortingOrder.Ascending } }
  )
  $: diagnostics = execution.diagnostics?.state === execution.currentState ? execution.diagnostics : undefined
  $: checks = new Map(diagnostics?.checks.map((check) => [check.transition, check]))
  $: ancestry = path.includes(execution._id) ? path : [...path, execution._id]

  function statusLabel (check: TransitionDiagnostic | undefined): IntlString {
    switch (check?.status) {
      case 'waiting':
        return plugin.string.DiagnosticCondition
      case 'event':
        return plugin.string.DiagnosticEvent
      case 'matched':
        return plugin.string.DiagnosticMatched
      case 'error':
        return plugin.string.DiagnosticError
      default:
        return plugin.string.DiagnosticNotChecked
    }
  }
</script>

{#if execution.status === ExecutionStatus.Done}
  <Label label={plugin.string.Done} />
{:else if execution.status === ExecutionStatus.Cancelled}
  <Label label={plugin.string.Cancelled} />
{:else if definition !== undefined}
  <div class="flex-col flex-gap-2">
    <strong><Label label={plugin.string.DiagnosticTitle} /></strong>
    {#if diagnostics}
      <div class="flex-row-center flex-gap-2 text-sm">
        <Label label={plugin.string.DiagnosticLastChecked} />
        <DateTimePresenter value={diagnostics.checkedAt} />
      </div>
    {/if}
    {#if execution.error != null}
      <ErrorTooltip value={execution.error} />
    {/if}
    {#each transitions as transition (transition._id)}
      {@const check = checks.get(transition._id)}
      <div class="check flex-col flex-gap-2">
        <div class="flex-row-center flex-gap-2">
          <TransitionPresenter {transition} direction="from" />
          <TriggerPresenter
            value={transition.trigger}
            process={definition}
            params={transition.triggerParams}
            withLabel
          />
        </div>
        <div class="text-sm"><Label label={statusLabel(check)} /></div>
        {#if check?.checkedAt !== undefined && check.checkedAt !== diagnostics?.checkedAt}
          <DateTimePresenter value={check.checkedAt} />
        {/if}
        {#each check?.reasons ?? [] as reason, index (index)}
          <ExecutionReason {reason} {execution} path={ancestry} />
        {/each}
        {#if check?.status === 'waiting' && check.reasons.length === 0}
          <Label label={plugin.string.DiagnosticNoDetails} />
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .check {
    border-left: 2px solid var(--theme-divider-color);
    padding-left: 0.75rem;
  }
</style>
