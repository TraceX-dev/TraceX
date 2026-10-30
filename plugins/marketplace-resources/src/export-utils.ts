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

import type { MasterTag } from '@hcengineering/card'
import type { AccountUuid } from '@hcengineering/core'
import marketplace, { getDefinitionPackageInfo, type DefinitionPackageInfo } from '@hcengineering/marketplace'
import type { Process } from '@hcengineering/process'
import type { DropdownIntlItem } from '@hcengineering/ui'

/** Only the recorded author is offered a new version of an existing package. */
export function getDefinitionPackageExportItems (
  info: DefinitionPackageInfo | undefined,
  author: AccountUuid
): DropdownIntlItem[] {
  if (info === undefined) return [{ id: 'make-package', label: marketplace.string.MakePackage }]
  return info.author === author
    ? [{ id: 'new-package-version', label: marketplace.string.CreateNewPackageVersion }]
    : []
}

/** An embedded process inherits its card type's package unless it has its own package. */
export function getDefinitionPackageOwner (definition: MasterTag | Process, masterTag?: MasterTag): MasterTag | Process {
  return getDefinitionPackageInfo(definition) === undefined &&
    'masterTag' in definition &&
    masterTag?._id === definition.masterTag &&
    getDefinitionPackageInfo(masterTag) !== undefined
    ? masterTag
    : definition
}
