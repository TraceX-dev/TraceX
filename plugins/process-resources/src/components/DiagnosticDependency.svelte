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
  import cardPlugin, { type Card } from '@hcengineering/card'
  import contact from '@hcengineering/contact'
  import type { Doc, Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import process, { ExecutionStatus, type ApproveRequest, type DiagnosticDependency, type Execution, type ProcessToDo } from '@hcengineering/process'
  import { Component, Expandable, Label } from '@hcengineering/ui'
  import { ObjectPresenter } from '@hcengineering/view-resources'
  import plugin from '../plugin'
  import ExecutionWaiting from './ExecutionWaiting.svelte'

  export let dependency: DiagnosticDependency
  export let path: Ref<Execution>[]

  const client = getClient()
  const query = createQuery()
  const cardQuery = createQuery()
  const sourceQuery = createQuery()
  let doc: Doc | undefined
  let card: Card | undefined
  let sourceCard: Card | undefined
  let loaded = false
  let cardLoaded = false
  let expanded = false

  $: query.query(dependency._class, { _id: dependency._id }, (result) => {
    doc = result[0]
    loaded = true
  })
  $: child = doc !== undefined && client.getHierarchy().isDerived(doc._class, process.class.Execution)
    ? doc as Execution : undefined
  $: todo = doc !== undefined && client.getHierarchy().isDerived(doc._class, process.class.ProcessToDo)
    ? doc as ProcessToDo : undefined
  $: approval = todo !== undefined && client.getHierarchy().isDerived(todo._class, process.class.ApproveRequest)
    ? todo as ApproveRequest : undefined
  $: cardId = child?.card ?? todo?.attachedTo as Ref<Card> | undefined
  $: if (cardId !== undefined) {
    cardQuery.query(cardPlugin.class.Card, { _id: cardId }, (result) => {
      card = result[0]
      cardLoaded = true
    })
  } else {
    cardQuery.unsubscribe()
    card = undefined
    cardLoaded = false
  }
  $: state = child === undefined ? undefined : client.getModel().findObject(child.currentState)
  $: association = child?.source?.association === undefined ? undefined : client.getModel().findObject(child.source.association)
  $: if (child?.source !== undefined) {
    sourceQuery.query(cardPlugin.class.Card, { _id: child.source.card }, (result) => { sourceCard = result[0] })
  } else {
    sourceQuery.unsubscribe()
    sourceCard = undefined
  }
  $: sourceField = sourceCard === undefined || child?.source?.field === undefined ? undefined
    : client.getHierarchy().findAttribute(sourceCard._class, child.source.field)?.label
  $: cycle = child !== undefined && path.includes(child._id)
  $: depthLimited = path.length >= 5
  $: available = doc !== undefined && (cardId === undefined || card !== undefined)
</script>

{#if available && doc !== undefined}
  <div class="dependency flex-col flex-gap-2">
    {#if dependency.matched !== undefined}
      <div class="text-sm"><Label label={dependency.matched ? plugin.string.DiagnosticMatched : plugin.string.DiagnosticCondition} /></div>
    {/if}
    <div class="flex-row-center flex-gap-2">
      {#if sourceCard !== undefined}<ObjectPresenter value={sourceCard} /> → {/if}
      {#if association !== undefined}<span>{child?.source?.direction === 'A' ? association.nameA : association.nameB} →</span>{/if}
      {#if sourceField !== undefined}<Label label={sourceField} /> → {/if}
      {#if card}<ObjectPresenter value={card} /> → {/if}
      <ObjectPresenter value={doc} />
    </div>
    {#if child !== undefined}
      <div class="flex-row-center flex-gap-2 text-sm">
        {#if child.error != null}<Label label={plugin.string.Error} />
        {:else if child.status === ExecutionStatus.Cancelled}<Label label={plugin.string.Cancelled} />
        {:else if child.status === ExecutionStatus.Done}<Label label={plugin.string.Done} />
        {:else}<Label label={plugin.string.DiagnosticPending} />{/if}
        {#if state}<span>{state.title}</span>{/if}
      </div>
      {#if cycle}<Label label={plugin.string.DiagnosticCycle} />
      {:else if depthLimited}<Label label={plugin.string.DiagnosticDepth} />
      {:else}
        <Expandable label={plugin.string.DiagnosticTitle} bind:expanded>
          {#if expanded}<ExecutionWaiting execution={child} path={[...path, child._id]} />{/if}
        </Expandable>
      {/if}
    {:else if todo !== undefined}
      <div class="flex-row-center flex-gap-2">
        <Component is={contact.component.EmployeePresenter} props={{ value: todo.user }} />
        <Label label={approval?.approved === false ? plugin.string.DiagnosticRejected : todo.doneOn != null ? plugin.string.Done : plugin.string.DiagnosticPending} />
      </div>
    {/if}
  </div>
{:else if loaded && (cardId === undefined || cardLoaded)}
  <Label label={plugin.string.DiagnosticUnavailable} />
{/if}

<style>
  .dependency {
    padding: 0.5rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
  }
</style>
