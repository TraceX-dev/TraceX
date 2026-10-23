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
  import type { Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import type { Execution, ExecutionReason } from '@hcengineering/process'
  import { Button, Component, DateTimePresenter, Label } from '@hcengineering/ui'
  import plugin from '../plugin'
  import DiagnosticDependency from './DiagnosticDependency.svelte'

  export let reason: ExecutionReason
  export let execution: Execution
  export let path: Ref<Execution>[]
  export let depth = 0

  const client = getClient()
  let limit = 20
  $: definition = client.getModel().findObject(execution.process)
  $: fields = (reason.fields ?? []).map((key) => ({
    key,
    label:
      definition === undefined
        ? undefined
        : client.getHierarchy().findAttribute(definition.masterTag, definition.bindings?.[key] ?? key)?.label
  }))
  $: dependencies = reason.dependencies ?? []
  $: states = (reason.states ?? []).map((id) => client.getModel().findObject(id)?.title).filter(Boolean)

  function showMore (): void {
    limit += 20
  }
</script>

<div class="flex-col flex-gap-2">
  {#if reason.presenter !== undefined}
    <Component is={reason.presenter} props={{ reason, execution }} />
  {:else}
    <div><Label label={reason.message} params={reason.params ?? {}} /></div>
    {#if reason.mode}
      <div class="text-sm">
        <Label
          label={reason.mode === 'all'
            ? plugin.string.DiagnosticAll
            : reason.mode === 'any'
              ? plugin.string.DiagnosticAny
              : plugin.string.DiagnosticNone}
        />
      </div>
    {/if}
    {#if reason.until !== undefined}<DateTimePresenter value={reason.until} />{/if}
    {#if states.length > 0}<div>{states.join(', ')}</div>{/if}
    {#each fields as field (field.key)}
      <div>
        {#if field.label}<Label label={field.label} />{:else}{field.key}{/if}
      </div>
    {/each}
    {#each dependencies.slice(0, limit) as dependency (dependency._id)}
      <DiagnosticDependency {dependency} {path} />
    {/each}
    {#if dependencies.length > limit}
      <Button label={plugin.string.DiagnosticMore} kind="secondary" size="small" on:click={showMore} />
    {/if}
    {#if reason.total !== undefined && dependencies.length > 0 && reason.total > dependencies.length}
      <Label label={plugin.string.DiagnosticTruncated} params={{ count: dependencies.length }} />
    {/if}
    {#if depth < 4}
      {#each reason.children ?? [] as child, index (index)}
        <svelte:self reason={child} {execution} {path} depth={depth + 1} />
      {/each}
    {/if}
  {/if}
</div>
