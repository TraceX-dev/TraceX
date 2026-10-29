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

import type { AccountUuid } from '@hcengineering/core'
import type { ProcessAuthoringResult } from '@hcengineering/process'

/** Publisher-qualified package identity and immutable release number. */
export interface DefinitionPackageManifest {
  readonly id: string
  readonly version: string
  readonly author?: AccountUuid
  readonly description?: string
}

/** Validated artifact; the compiled definition is derived from source, never trusted on input. */
export interface DefinitionPackageRelease {
  readonly package: DefinitionPackageManifest
  readonly source: string
  readonly contentHash: string
  readonly definition: ProcessAuthoringResult
}

export interface DefinitionPackageChange {
  readonly key: string
  readonly class: string
  readonly operation: 'added' | 'removed' | 'modified'
  readonly resolution: 'upstream' | 'local' | 'converged' | 'conflict'
  readonly impact: 'cosmetic' | 'additive' | 'behavioral' | 'destructive' | 'unknown'
  readonly paths: readonly string[]
  readonly reason: string
}

/** Offline findings are candidates for destination analysis, never authorization to apply. */
export interface DefinitionPackageUpgradePlan {
  readonly packageId: string
  readonly fromVersion: string
  readonly toVersion: string
  readonly status: 'unchanged' | 'compatible-candidate' | 'review-required' | 'conflict'
  readonly changes: readonly DefinitionPackageChange[]
  readonly reviewReasons: readonly string[]
  readonly canAutoApply: false
}
