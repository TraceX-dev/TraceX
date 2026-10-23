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
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { Card } from '@hcengineering/card'
import { CollaboratorClient } from '@hcengineering/collaborator-client'
import { Doc, MeasureContext, PersonId, Ref, Timestamp, Tx, TxOperations, WorkspaceUuid } from '@hcengineering/core'
import { Execution, ExecutionError, MethodParams, Trigger, UserResult, ExecutionReason, SelectedContext } from '@hcengineering/process'

export type ExecuteFunc = (
  params: MethodParams<Doc>,
  execution: Execution,
  control: ProcessControl,
  results: UserResult[] | undefined
) => Promise<ExecuteResult>

export type ExecuteResult = SuccessExecutionResult | ExecutionError

export interface SuccessExecutionResult {
  txes: Tx[]
  rollback: Tx[] | undefined
  context: SuccessExecutionContext[] | null
  results?: SuccessExecutionContext[]
}

export interface SuccessExecutionContext {
  _id: string
  value: any
}

export type TransformFunc = (
  value: any,
  props: Record<string, any>,
  control: ProcessControl,
  execution: Execution
) => Promise<any>

export interface ProcessMessage {
  _id?: string
  account: PersonId
  createdOn: Timestamp
  event: Ref<Trigger>[]
  context: Record<string, any>
  execution?: Ref<Execution>
  card?: Ref<Card>
}

export interface ProcessControl {
  ctx: MeasureContext
  client: TxOperations
  collaboratorFactory: () => CollaboratorClient
  cache: Map<string, any>
  messageContext: Record<string, any>
  workspace: WorkspaceUuid
  modifiedBy: PersonId
  modifiedOn: Timestamp
  /** Optional observation channel; it must never influence the check result. */
  diagnostics?: (reason: ExecutionReason) => void
  /** Original selectors for the current method's inputs, without their resolved values. */
  inputSources?: Record<string, SelectedContext>
}

export type RollbackFunc = (context: Record<string, any>, control: ProcessControl) => Tx

export interface TimeMachineMessage {
  type: 'schedule' | 'cancel'
  id: string
  targetDate?: Timestamp
  topic?: string
  data?: any
}
