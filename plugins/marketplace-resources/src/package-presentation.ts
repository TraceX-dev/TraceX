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

import card from '@hcengineering/card'
import type { DefinitionPackageRelease } from '@hcengineering/marketplace'
import { getEmbeddedLabel } from '@hcengineering/platform'
import process from '@hcengineering/process'

/** Uses definition names in package previews instead of exposing generated package IDs. */
export function getPackageName (release: DefinitionPackageRelease): string {
  const root = release.definition.kind === 'card' ? card.class.MasterTag : process.class.Process
  const prefix = getEmbeddedLabel('')
  return (
    release.definition.docs
      .filter((doc) => doc._class === root)
      .map((doc) => {
        const name = String(doc.name ?? doc.label ?? '')
        return name.startsWith(prefix) ? name.slice(prefix.length) : name
      })
      .filter((name) => name !== '')
      .join(', ') || release.package.id
  )
}
