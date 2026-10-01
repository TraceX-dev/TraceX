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
  import { AccountRole, Class, Doc, getCurrentAccount, hasAccountRole, Ref } from '@hcengineering/core'
  import { getEmbeddedLabel, setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { ApproveRequest, EventButton, Execution, ExecutionStatus, Process, ProcessToDo } from '@hcengineering/process'
  import { Button, showPopup } from '@hcengineering/ui'
  import RequestAttachments from './RequestAttachments.svelte'
  import process from '../plugin'
  import { createExecution } from '../utils'
  import ApproveRequestButtons from './ApproveRequestButtons.svelte'
  import { canParticipateInProcessesStore, isGuestInputRequired } from '../guestParticipation'

  export let card: Card

  let docs: Execution[] = []
  let todos: ProcessToDo[] = []
  let actions: EventButton[] = []
  let headerProcesses: Process[] = []
  let pendingButtons = new Set<Ref<Doc>>()

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
  const account = getCurrentAccount()
  // Guests only complete the tasks assigned to them: events, starting and rolling back processes are not
  // available to them yet and would be rejected by the server.
  const isGuest = !hasAccountRole(account, AccountRole.User)

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

  async function submitButton (id: Ref<Doc>, submit: () => Promise<unknown>): Promise<void> {
    if (pendingButtons.has(id)) return
    pendingButtons = new Set(pendingButtons).add(id)
    try {
      await submit()
    } catch (error: unknown) {
      await setPlatformStatus(unknownError(error))
    } finally {
      pendingButtons.delete(id)
      pendingButtons = new Set(pendingButtons)
    }
  }

  async function checkTodo (todo: ProcessToDo): Promise<void> {
    await submitButton(todo._id, () =>
      client.update(todo, {
        doneOn: new Date().getTime()
      })
    )
  }

  async function performAction (action: EventButton): Promise<void> {
    if (action.requireAttachments === true) {
      showPopup(RequestAttachments, { action, card })
      return
    }
    await submitButton(action._id, () =>
      client.createDoc(process.class.ProcessCustomEvent, action.space, {
        execution: action.execution,
        eventType: action.eventType,
        card: card._id
      })
    )
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
  $: activeExecutionIds = new Set(docs.map((d) => d._id))
  $: visibleHeaderProcesses = headerProcesses.filter(
    (value) => !value.parallelExecutionForbidden || !activeProcesses.has(value._id)
  )

  function isRequest (todo: ProcessToDo): todo is ApproveRequest {
    return todo._class === process.class.ApproveRequest
  }
</script>

{#if $canParticipateInProcessesStore}
  {#each todos as todo (todo._id)}
    {#if isRequest(todo)}
      <ApproveRequestButtons {todo} card={card._id} />
    {:else}
      {@const inputBlocked = isGuestInputRequired(account, todo)}
      <Button
        kind={'primary'}
        label={getEmbeddedLabel(todo.title)}
        disabled={inputBlocked}
        loading={pendingButtons.has(todo._id)}
        showTooltip={inputBlocked ? { label: process.string.GuestInputNotSupported } : undefined}
        on:click={() => checkTodo(todo)}
      />
    {/if}
  {/each}
{/if}
{#if !isGuest}
  {#each actions as action (action._id)}
    {#if activeExecutionIds.has(action.execution) && (action.user === undefined || action.user === emp)}
      <Button
        kind={'primary'}
        label={getEmbeddedLabel(action.title)}
        loading={pendingButtons.has(action._id)}
        on:click={() => performAction(action)}
      />
    {/if}
  {/each}
  {#each visibleHeaderProcesses as headerProcess (headerProcess._id)}
    <Button kind={'primary'} label={getEmbeddedLabel(headerProcess.name)} on:click={() => runProcess(headerProcess)} />
  {/each}
  {#each rollbacks as rollback}
    {getExecutionLabel(rollback)}
    <Button kind={'dangerous'} label={process.string.Rollback} on:click={() => performRollback(rollback)} />
  {/each}
{/if}
