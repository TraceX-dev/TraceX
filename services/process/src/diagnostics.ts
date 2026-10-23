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

import process from '@hcengineering/process'
import type { Execution, ExecutionDiagnostics, ExecutionReason, Transition } from '@hcengineering/process'
import type { ProcessControl } from '@hcengineering/server-process'

const MAX_DEPENDENCIES = 200
const MAX_REASONS = 20
const MAX_DEPTH = 4

/** Bound extension-provided observations without retaining entire documents or raw field values. */
export function copyExecutionReason (reason: ExecutionReason): ExecutionReason {
  return copyReason(reason, 0, { remaining: 100, references: MAX_DEPENDENCIES })
}

function copyReason (
  reason: ExecutionReason,
  depth: number,
  budget: { remaining: number, references: number }
): ExecutionReason {
  budget.remaining--
  const dependencies = reason.dependencies?.slice(0, budget.references).map((dependency) => ({
    _id: dependency._id,
    _class: dependency._class,
    matched: dependency.matched
  }))
  budget.references -= dependencies?.length ?? 0
  const children: ExecutionReason[] = []
  if (depth < MAX_DEPTH) {
    for (const child of reason.children?.slice(0, MAX_REASONS) ?? []) {
      if (budget.remaining === 0) break
      children.push(copyReason(child, depth + 1, budget))
    }
  }
  return {
    code: reason.code,
    message: reason.message,
    params:
      reason.params === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(reason.params)
              .slice(0, MAX_REASONS)
              .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
              .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 500) : value])
          ),
    mode: reason.mode,
    total: reason.total,
    matched: reason.matched,
    dependencies,
    fields: reason.fields?.slice(0, MAX_REASONS),
    states: reason.states?.slice(0, MAX_REASONS),
    until: reason.until,
    presenter: reason.presenter,
    children: children.length > 0 ? children : undefined
  }
}

/** Include event-only alternatives without invoking checks outside the actual event/priority path. */
export function createExecutionDiagnostics (
  control: ProcessControl,
  execution: Execution,
  candidates: Transition[]
): ExecutionDiagnostics {
  const outgoing = control.client.getModel().findAllSync(process.class.Transition, {
    process: execution.process,
    from: execution.currentState
  })
  const transitions = new Map([...outgoing, ...candidates].map((transition) => [transition._id, transition]))
  const candidateIds = new Set(candidates.map((transition) => transition._id))
  const previous = new Map(
    execution.diagnostics?.state === execution.currentState
      ? execution.diagnostics.checks.map((check) => [check.transition, check])
      : []
  )
  return {
    state: execution.currentState,
    checkedAt: Date.now(),
    checks: Array.from(transitions.values()).map((transition) => {
      const known = previous.get(transition._id)
      if (!candidateIds.has(transition._id) && known !== undefined) return { ...known, reasons: [...known.reasons] }
      return {
        transition: transition._id,
        status: control.client.getModel().findObject(transition.trigger)?.auto === false ? 'event' : 'not-evaluated',
        reasons: []
      }
    })
  }
}

/** Diagnostic storage failures must not suppress a real transition or request an action retry. */
export async function saveExecutionDiagnostics (
  control: ProcessControl,
  execution: Execution,
  diagnostics: ExecutionDiagnostics
): Promise<void> {
  try {
    await control.client.update(execution, { diagnostics })
    execution.diagnostics = diagnostics
  } catch (error) {
    control.ctx.error('Could not save process diagnostics', { execution: execution._id, error })
  }
}
