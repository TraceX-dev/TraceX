//
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

import card from '@hcengineering/card'
import { getCurrentEmployee } from '@hcengineering/contact'
import core, { AccountRole, getCurrentAccount, hasAccountRole, TxProcessor } from '@hcengineering/core'
import type { Client, Ref, Tx, TxApplyIf, TxCreateDoc, TxRemoveDoc, TxUpdateDoc } from '@hcengineering/core'
import { setPlatformStatus, unknownError } from '@hcengineering/platform'
import process, { ExecutionStatus } from '@hcengineering/process'
import type { EventButton, Execution, Process } from '@hcengineering/process'
import { showPopup } from '@hcengineering/ui'
import RequestAttachments from './components/RequestAttachments.svelte'

// Stop following a chain if the server never completes its transition.
const INPUT_TIMEOUT = 60_000

interface InputScope {
  executions: Set<Ref<Execution>>
  requests: Set<Ref<EventButton>>
  timeout: ReturnType<typeof setTimeout>
  committed: boolean
  cancelled: boolean
}

interface TrackedExecution {
  scope: InputScope
  process: Ref<Process>
}

interface PendingInput {
  scope: InputScope
  action: EventButton
}

export interface AttachmentInputWatch {
  commit: () => void
  cancel: () => void
}

/** Opens attachment requests produced by a locally initiated completion and its subprocesses. */
export class AttachmentInput {
  private readonly executions = new Map<Ref<Execution>, TrackedExecution>()
  private readonly scopes = new Set<InputScope>()
  private pending: PendingInput[] = []
  private opening = false
  private closed = false
  private closePopup?: () => void

  constructor (private readonly client: Client) {}

  /** Starts capturing requests before submission; commit enables their presentation after success. */
  watch (executions: Execution[]): AttachmentInputWatch {
    const scope: InputScope = {
      executions: new Set(),
      requests: new Set(),
      timeout: setTimeout(() => {
        this.stop(scope)
      }, INPUT_TIMEOUT),
      committed: false,
      cancelled: false
    }
    this.scopes.add(scope)
    if (!this.closed && hasAccountRole(getCurrentAccount(), AccountRole.User)) {
      for (const execution of executions) {
        if (this.executions.has(execution._id)) continue
        scope.executions.add(execution._id)
        this.executions.set(execution._id, { scope, process: execution.process })
      }
    }
    if (scope.executions.size === 0) this.stop(scope)
    return {
      commit: () => {
        scope.committed = true
        this.openNext()
      },
      cancel: () => {
        scope.cancelled = true
        this.stop(scope)
        this.pending = this.pending.filter((input) => input.scope !== scope)
      }
    }
  }

  /** Follows server-created descendants without waiting for popup interaction in the notification pipeline. */
  notify (...txes: Tx[]): void {
    if (this.closed || this.executions.size === 0) return
    const transactions = txes.flatMap((tx) => this.unwrap(tx))
    // Register children before handling the parent's state update in the same batch.
    for (const tx of transactions) {
      if (tx._class !== core.class.TxCreateDoc) continue
      const create = tx as TxCreateDoc<Execution>
      if (create.objectClass !== process.class.Execution) continue
      const parentId = create.attributes.parentId
      const parent = parentId === undefined ? undefined : this.executions.get(parentId)
      if (parent === undefined) continue
      parent.scope.executions.add(create.objectId)
      this.executions.set(create.objectId, { scope: parent.scope, process: create.attributes.process })
    }
    for (const tx of transactions) {
      if (tx._class !== core.class.TxCreateDoc) continue
      const create = tx as TxCreateDoc<EventButton>
      if (create.objectClass !== process.class.EventButton) continue
      const action = TxProcessor.createDoc2Doc(create)
      const tracked = this.executions.get(action.execution)
      if (
        tracked === undefined ||
        action.requireAttachments === undefined ||
        (action.user !== undefined && action.user !== getCurrentEmployee()) ||
        tracked.scope.requests.has(action._id)
      ) {
        continue
      }
      tracked.scope.requests.add(action._id)
      this.pending.push({ scope: tracked.scope, action })
    }
    for (const tx of transactions) {
      if (tx._class === core.class.TxRemoveDoc) {
        this.untrack((tx as TxRemoveDoc<Execution>).objectId)
      } else if (tx._class === core.class.TxUpdateDoc) {
        const update = tx as TxUpdateDoc<Execution>
        const tracked = this.executions.get(update.objectId)
        if (tracked === undefined) continue
        const { status, error, currentState } = update.operations
        const waiting = currentState != null && !this.hasAutoTransitions(tracked.process, currentState)
        if ((status !== undefined && status !== ExecutionStatus.Active) || error != null || waiting) {
          this.untrack(update.objectId)
        }
      }
    }
    this.openNext()
  }

  /** Releases timers, queued inputs and the active popup when the client closes. */
  close (): void {
    this.closed = true
    for (const scope of this.scopes) this.stop(scope)
    this.pending = []
    this.closePopup?.()
    this.closePopup = undefined
  }

  private unwrap (tx: Tx): Tx[] {
    return tx._class === core.class.TxApplyIf ? (tx as TxApplyIf).txes.flatMap((value) => this.unwrap(value)) : [tx]
  }

  private hasAutoTransitions (processId: Ref<Process>, state: Execution['currentState']): boolean {
    const model = this.client.getModel()
    return model
      .findAllSync(process.class.Transition, { process: processId, from: state })
      .some(
        (transition) =>
          transition.trigger !== process.trigger.OnSubProcessesDone &&
          model.findObject(transition.trigger)?.auto === true
      )
  }

  private untrack (id: Ref<Execution>): void {
    const tracked = this.executions.get(id)
    if (tracked === undefined) return
    this.executions.delete(id)
    tracked.scope.executions.delete(id)
    if (tracked.scope.executions.size === 0) this.stop(tracked.scope)
  }

  private stop (scope: InputScope): void {
    clearTimeout(scope.timeout)
    for (const id of scope.executions) this.executions.delete(id)
    scope.executions.clear()
    this.scopes.delete(scope)
  }

  private openNext (): void {
    if (this.closed || this.opening) return
    const index = this.pending.findIndex((input) => input.scope.committed && !input.scope.cancelled)
    if (index === -1) return
    const [input] = this.pending.splice(index, 1)
    this.opening = true
    void this.open(input)
      .catch(async (error: unknown) => {
        await setPlatformStatus(unknownError(error))
      })
      .finally(() => {
        this.opening = false
        this.openNext()
      })
  }

  private async open (input: PendingInput): Promise<void> {
    const [action, execution, target] = await Promise.all([
      this.client.findOne(process.class.EventButton, { _id: input.action._id }),
      this.client.findOne(process.class.Execution, { _id: input.action.execution, status: ExecutionStatus.Active }),
      this.client.findOne(card.class.Card, { _id: input.action.card })
    ])
    if (
      this.closed ||
      input.scope.cancelled ||
      action === undefined ||
      execution === undefined ||
      target === undefined ||
      execution.error != null ||
      action.requireAttachments === undefined ||
      (action.user !== undefined && action.user !== getCurrentEmployee())
    ) {
      return
    }
    await new Promise<void>((resolve) => {
      const popup = showPopup(RequestAttachments, { action, card: target }, undefined, () => {
        this.closePopup = undefined
        resolve()
      })
      this.closePopup = () => {
        popup.close()
        resolve()
      }
    })
  }
}
