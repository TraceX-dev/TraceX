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

import type { Association, Class, Doc, Ref } from '@hcengineering/core'
import type { Card } from '@hcengineering/card'
import type { IntlString } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'
import type { State, Transition } from './index'

/** References are resolved through the viewing user's client, never copied as privileged documents. */
export interface DiagnosticDependency {
  _class: Ref<Class<Doc>>
  _id: Ref<Doc>
  matched?: boolean
}

/** An operation may publish domain-specific evidence during its normal check. */
export interface ExecutionReason {
  code: string
  message: IntlString
  params?: Record<string, string | number | boolean>
  mode?: 'all' | 'any' | 'none'
  total?: number
  matched?: number
  dependencies?: DiagnosticDependency[]
  fields?: string[]
  states?: Ref<State>[]
  until?: number
  children?: ExecutionReason[]
  presenter?: AnyComponent
}

export interface TransitionDiagnostic {
  transition: Ref<Transition>
  status: 'waiting' | 'matched' | 'event' | 'not-evaluated' | 'error'
  checkedAt?: number
  reasons: ExecutionReason[]
}

/** A bounded snapshot of actual checks, not an independent simulation of the process. */
export interface ExecutionDiagnostics {
  state: Ref<State>
  checkedAt: number
  checks: TransitionDiagnostic[]
}

/** Selector provenance captured when a child is launched; it does not imply a live relationship. */
export interface ExecutionSource {
  card: Ref<Card>
  association?: Ref<Association>
  direction?: 'A' | 'B'
  field?: string
}
