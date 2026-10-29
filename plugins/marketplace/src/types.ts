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

import type { AccountUuid, Doc, Ref } from '@hcengineering/core'
import type { MasterTag } from '@hcengineering/card'
import type { DefinitionPackageManifest } from './definition-package-types'

/** Package metadata retained on an existing editable definition. */
export interface DefinitionPackageInfo {
  id: string
  version: string
  author: AccountUuid
  description?: string
  members?: Ref<Doc>[]
}

/** Structural extension owned by Marketplace; card and process models remain independent. */
export interface DefinitionPackageOwner extends Doc {
  definitionPackage?: DefinitionPackageInfo
  description?: string
  definitionPackageInstallation?: { id: Ref<DefinitionPackageInstallation>, member: string }
}

/** Destination and slot bindings of one process within a package installation. */
export interface DefinitionPackageDestination {
  masterTag: Ref<MasterTag>
  bindings: Record<string, string>
}

/** Workspace-local installation baseline; ordinary editable definitions remain in their owning domains. */
export interface DefinitionPackageInstallation extends Doc {
  name: string
  package: DefinitionPackageManifest
  release: string
  identities: Record<string, string>
  destinations: Record<string, DefinitionPackageDestination>
}

/** Reads Marketplace metadata without extending the owning feature's public document type. */
export function getDefinitionPackageInfo (definition: Doc): DefinitionPackageInfo | undefined {
  return (definition as DefinitionPackageOwner).definitionPackage
}

/** Removes workspace package membership from a portable definition without mutating its owner. */
export function stripDefinitionPackageInfo<T extends Doc> (definition: T): T {
  const result = { ...definition }
  Reflect.deleteProperty(result, 'definitionPackage')
  Reflect.deleteProperty(result, 'definitionPackageInstallation')
  return result
}
