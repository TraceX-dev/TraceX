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

import type { MasterTag } from '@hcengineering/card'
import type { Ref } from '@hcengineering/core'
import type { Process } from '@hcengineering/process'
import { showPopup } from '@hcengineering/ui'
import { getRequiredSlots, importProcess, isYamlSlotBindingCompatible, updateProcessYaml } from './exporter'
import { isDefinitionPackageSource } from '@hcengineering/marketplace'
import { DefinitionPackageInstallPopup, ImportSlotsPopup } from '@hcengineering/marketplace-resources'

/** Resolves field bindings and applies a new definition or replaces the selected process. */
export async function applyProcessDefinition (
  masterTag: Ref<MasterTag>,
  source: string,
  initialBindings: Record<string, string> = {},
  current?: Process
): Promise<boolean> {
  if (isDefinitionPackageSource(source)) {
    if (current !== undefined) throw new Error('Install packages through the process list or Marketplace')
    return await new Promise<boolean>((resolve) => {
      showPopup(DefinitionPackageInstallPopup, { source, masterTag }, 'centered', (result) => {
        resolve(result === true)
      })
    })
  }
  const slots = getRequiredSlots(source)
  const save = async (bindings: Record<string, string>): Promise<boolean> => {
    if (current !== undefined) await updateProcessYaml(current, source, bindings)
    else await importProcess(masterTag, source, bindings)
    return true
  }
  if (slots === undefined || Object.keys(slots).length === 0) return await save({})
  const compatible: Record<string, string> = {}
  for (const [key, slot] of Object.entries(slots)) {
    const bound = initialBindings[key]
    if (bound === undefined) continue
    if (isYamlSlotBindingCompatible(masterTag, slot, bound, initialBindings, current)) compatible[key] = bound
  }
  return await new Promise<boolean>((resolve, reject) => {
    showPopup(
      ImportSlotsPopup,
      { requiredSlots: slots, masterTag, initialBindings: compatible },
      undefined,
      (bindings) => {
        if (bindings === undefined || bindings === null) resolve(false)
        else void save(bindings as Record<string, string>).then(resolve, reject)
      }
    )
  })
}
