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

import card, { type MasterTag } from '@hcengineering/card'
import core, { type Ref } from '@hcengineering/core'
import {
  DefinitionPackageError,
  type CatalogPackageOriginInput,
  type DefinitionPackageOwner,
  type DefinitionPackageRelease
} from '@hcengineering/marketplace'
import { translate } from '@hcengineering/platform'
import { getClient, getCurrentWorkspaceUuid } from '@hcengineering/presentation'
import process, { type Process } from '@hcengineering/process'
import { getCurrentResolvedLocation } from '@hcengineering/ui'

/** Capture live definition identities only for the private publication request. */
export async function createPackageOrigin (definition: DefinitionPackageOwner): Promise<CatalogPackageOriginInput> {
  const client = getClient()
  const isProcess = definition._class === process.class.Process
  const workflow = isProcess ? client.getModel().findObject<Process>(definition._id as Ref<Process>) : undefined
  const typeId = workflow?.masterTag ?? definition._id
  const path = ['setting', 'types', typeId]
  const currentPath = getCurrentResolvedLocation().path
  if (isProcess && currentPath[5] === 'process:component:ProcessEditor') {
    path.push(currentPath[5], definition._id)
  }
  const labels: string[] = []
  const visited = new Set<string>()
  let id: Ref<MasterTag> | undefined = typeId as Ref<MasterTag>
  while (id !== undefined && !visited.has(id)) {
    visited.add(id)
    const tag: MasterTag | undefined = client.getModel().findObject<MasterTag>(id)
    if (tag === undefined || (tag._class !== card.class.MasterTag && tag._class !== card.class.Tag)) break
    labels.unshift(await translate(tag.label, {}))
    id = tag.extends
  }
  if (workflow !== undefined) labels.push(workflow.name)
  if (labels.length === 0) throw new DefinitionPackageError('package', 'The package origin is unavailable')
  return { workspace: getCurrentWorkspaceUuid(), path, labels }
}

/** Recover file publication provenance only from matching live local package membership. */
export async function findLocalPackageOrigin (
  release: DefinitionPackageRelease
): Promise<CatalogPackageOriginInput | undefined> {
  const model = getClient().getModel()
  const definitions: DefinitionPackageOwner[] = [
    ...model.findAllSync(core.class.Class, {}),
    ...model.findAllSync(process.class.Process, {})
  ]
  const definition = definitions.find((candidate) => {
    const info = candidate.definitionPackage
    return info !== undefined &&
      info.id === release.package.id &&
      info.author === release.package.author &&
      info.version === release.package.version
  })
  return definition === undefined ? undefined : await createPackageOrigin(definition)
}
