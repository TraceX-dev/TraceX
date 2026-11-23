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

import core, { type Class, type Data, type Doc, type Ref, type TxOperations } from '@hcengineering/core'
import print, { type PrintConfiguration } from '@hcengineering/print'

/** Initialize declared base-class defaults without overwriting administrator changes. */
export async function ensurePrintConfigurations (
  tx: Pick<TxOperations, 'findOne' | 'findAll' | 'getHierarchy' | 'createDoc' | 'updateDoc'>,
  legacyClass: Ref<Class<Doc>>
): Promise<void> {
  const legacy = await tx.findOne(print.class.PrintConfiguration, { _id: print.ids.PrintConfiguration })
  if (legacy !== undefined && legacy.targetClass === undefined) {
    await tx.updateDoc(legacy._class, legacy.space, legacy._id, { targetClass: legacyClass, enabled: true })
  }
  const hierarchy = tx.getHierarchy()
  const classes = await tx.findAll(core.class.Class, {})
  for (const target of classes) {
    if (!hierarchy.hasMixin(target, print.mixin.PrintConfig)) continue
    const values = hierarchy.as(target, print.mixin.PrintConfig).defaultConfiguration
    if (values === undefined) continue
    const existing = await tx.findOne(print.class.PrintConfiguration, { targetClass: target._id })
    if (existing !== undefined) continue
    const targetClass = target._id as Ref<Class<Doc>>
    const data: Data<PrintConfiguration> = { ...values, targetClass }
    const id = (print.ids.PrintConfiguration + ':' + target._id) as Ref<PrintConfiguration>
    await tx.createDoc(print.class.PrintConfiguration, core.space.Workspace, data, id)
  }
}
