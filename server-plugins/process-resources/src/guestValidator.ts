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
//

import cardPlugin, { type Card } from '@hcengineering/card'
import core, { type Doc, type Tx, type TxCreateDoc, type TxCUD } from '@hcengineering/core'
import process, { type Execution, ExecutionStatus } from '@hcengineering/process'
import type { GuestTxDecision, GuestTxValidatorControl } from '@hcengineering/server-core'

const EXECUTION_ATTRIBUTES = ['process', 'currentState', 'card', 'rollback', 'context', 'status']

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function findCardCreate (
  applyTxes: Tx[],
  card: unknown,
  control: GuestTxValidatorControl
): TxCreateDoc<Card> | undefined {
  for (const tx of applyTxes) {
    if (tx._class !== core.class.TxCreateDoc) continue
    const createTx = tx as TxCreateDoc<Card>
    if (createTx.objectId !== card) continue
    if (!control.hierarchy.isDerived(createTx.objectClass, cardPlugin.class.Card)) continue
    return createTx
  }
  return undefined
}

function countExecutionCreates (
  applyTxes: Tx[],
  card: unknown,
  proc: unknown,
  control: GuestTxValidatorControl
): number {
  let count = 0
  for (const tx of applyTxes) {
    if (tx._class !== core.class.TxCreateDoc) continue
    const createTx = tx as TxCreateDoc<Execution>
    if (!control.hierarchy.isDerived(createTx.objectClass, process.class.Execution)) continue
    if (createTx.attributes.card === card && createTx.attributes.process === proc) count++
  }
  return count
}

/**
 * A guest may start the auto-start processes of a card it creates, in the same apply as the card, so the start
 * of the process can carry the values the guest entered in the input popup. Mirrors `ProcessMiddleware.handleCardCreate`
 * on the client and `OnCardCreate` on the server, which would otherwise start the same processes with an empty context.
 */
async function isAutoStartOnCardCreate (tx: TxCreateDoc<Execution>, control: GuestTxValidatorControl): Promise<boolean> {
  const attributes = tx.attributes as unknown as Record<string, unknown>
  const keys = Object.keys(attributes)
  if (!keys.every((key) => EXECUTION_ATTRIBUTES.includes(key))) return false
  if (attributes.status !== ExecutionStatus.Active) return false
  if (attributes.currentState != null) return false
  if (!Array.isArray(attributes.rollback) || attributes.rollback.length > 0) return false
  if (attributes.context !== undefined && !isPlainObject(attributes.context)) return false

  const cardTx = findCardCreate(control.applyTxes, attributes.card, control)
  if (cardTx === undefined || cardTx.objectSpace !== tx.objectSpace) return false
  // New versions of a card take the executions over on the server.
  const baseId = (cardTx.attributes as Partial<Card>).baseId
  if (baseId !== undefined && baseId !== cardTx.objectId) return false

  if (countExecutionCreates(control.applyTxes, attributes.card, attributes.process, control) !== 1) return false

  const proc = (
    await control.findAll(process.class.Process, { _id: attributes.process as Execution['process'] }, { limit: 1 })
  )[0]
  if (proc === undefined || proc.autoStart !== true) return false
  const ancestors = control.hierarchy
    .getAncestors(cardTx.objectClass)
    .filter((it) => control.hierarchy.isDerived(it, cardPlugin.class.Card))
  if (!ancestors.includes(proc.masterTag)) return false

  const initTransition = await control.findAll(
    process.class.Transition,
    { process: proc._id, from: null, trigger: process.trigger.OnExecutionStart },
    { limit: 1 }
  )
  return initTransition.length > 0
}

/**
 * Validates guest transactions of the process module.
 * @public
 */
export async function ValidateGuestTx (tx: TxCUD<Doc>, control: GuestTxValidatorControl): Promise<GuestTxDecision> {
  if (!control.hierarchy.isDerived(tx.objectClass, process.class.Execution)) return undefined
  // Updates and removals of executions stay with the generic guest rules, which reject them.
  if (tx._class !== core.class.TxCreateDoc) return undefined
  return (await isAutoStartOnCardCreate(tx as TxCreateDoc<Execution>, control)) ? 'allow' : 'deny'
}
