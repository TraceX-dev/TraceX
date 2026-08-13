<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { Card, MasterTag, Tag } from '@hcengineering/card'
  import { getCurrentEmployee } from '@hcengineering/contact'
  import { Class, Doc, Ref } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { ApproveRequest, EventButton, Execution, ExecutionStatus, Process, ProcessToDo } from '@hcengineering/process'
  import { Button } from '@hcengineering/ui'
  import process from '../plugin'
  import { createExecution } from '../utils'
  import ApproveRequestButtons from './ApproveRequestButtons.svelte'

  export let card: Card

  let docs: Execution[] = []
  let todos: ProcessToDo[] = []
  let actions: EventButton[] = []
  let headerProcesses: Process[] = []

  const buttonsQuery = createQuery()
  $: buttonsQuery.query(
    process.class.EventButton,
    {
      card: card._id
    },
    (res) => {
      actions = res
    }
  )

  const executionQuery = createQuery()
  $: executionQuery.query(
    process.class.Execution,
    {
      card: card._id,
      status: ExecutionStatus.Active
    },
    (res) => {
      docs = res
    }
  )

  type PossibleProcessClass = Ref<MasterTag | Tag>

  function getCardPossibleClasses (value: Card): PossibleProcessClass[] {
    const hierarchy = client.getHierarchy()
    const classes = new Set<Ref<Class<Doc>>>(hierarchy.getAncestors(value._class))
    const mixins = hierarchy.getAllPossibleMixins(value._class).filter((mixin) => hierarchy.hasMixin(value, mixin))
    for (const mixin of mixins) {
      classes.add(mixin)
    }
    return [...classes] as PossibleProcessClass[]
  }

  $: possibleProcessClasses = getCardPossibleClasses(card)

  const headerProcessesQuery = createQuery()
  $: headerProcessesQuery.query(
    process.class.Process,
    {
      masterTag: { $in: possibleProcessClasses },
      showInHeader: true,
      automationOnly: { $ne: true }
    },
    (res) => {
      headerProcesses = res
    }
  )

  const emp = getCurrentEmployee()

  const query = createQuery()
  $: query.query(
    process.class.ProcessToDo,
    {
      execution: { $in: docs.map((d) => d._id) },
      user: emp,
      doneOn: null
    },
    (res) => {
      todos = res
    }
  )

  const client = getClient()

  async function checkTodo (todo: ProcessToDo): Promise<void> {
    await client.update(todo, {
      doneOn: new Date().getTime()
    })
  }

  async function performAction (action: EventButton): Promise<void> {
    await client.createDoc(process.class.ProcessCustomEvent, action.space, {
      execution: action.execution,
      eventType: action.eventType,
      card: card._id
    })
  }

  async function performRollback (execution: Execution): Promise<void> {
    await client.createDoc(process.class.ProcessCustomEvent, execution.space, {
      execution: execution._id,
      eventType: 'rollback',
      card: card._id
    })
  }

  async function runProcess (value: Process): Promise<void> {
    const tx = await createExecution(card._id, value._id, card.space, client.txFactory)
    if (tx !== undefined) {
      await client.tx(tx)
    }
  }

  function getExecutionLabel (execution: Execution): string {
    const pr = client.getModel().findObject(execution.process)
    if (pr !== undefined) {
      return `${pr.name}: `
    }
    return ''
  }

  $: rollbacks = docs.filter((d) => d.rollback.length > 0)
  $: activeProcesses = new Set(docs.map((d) => d.process))
  $: visibleHeaderProcesses = headerProcesses.filter(
    (value) => !value.parallelExecutionForbidden || !activeProcesses.has(value._id)
  )

  function isRequest (todo: ProcessToDo): todo is ApproveRequest {
    return todo._class === process.class.ApproveRequest
  }
</script>

{#each todos as todo (todo._id)}
  {#if isRequest(todo)}
    <ApproveRequestButtons {todo} card={card._id} />
  {:else}
    <Button kind={'primary'} label={getEmbeddedLabel(todo.title)} on:click={() => checkTodo(todo)} />
  {/if}
{/each}
{#each actions as action (action._id)}
  <Button kind={'primary'} label={getEmbeddedLabel(action.title)} on:click={() => performAction(action)} />
{/each}
{#each visibleHeaderProcesses as headerProcess (headerProcess._id)}
  <Button kind={'primary'} label={getEmbeddedLabel(headerProcess.name)} on:click={() => runProcess(headerProcess)} />
{/each}
{#each rollbacks as rollback}
  {getExecutionLabel(rollback)}
  <Button kind={'dangerous'} label={process.string.Rollback} on:click={() => performRollback(rollback)} />
{/each}
