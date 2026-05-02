//
// Copyright © 2026 TraceX.
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

import contact from '@hcengineering/contact'
import core from '@hcengineering/core'
import { TypeBoolean, TypeRef, TypeString, TypeTimestamp, type Builder } from '@hcengineering/model'
import { createSystemType } from '@hcengineering/model-card'
import { PaletteColorIndexes } from '@hcengineering/ui/src/colors'

import qalico from './plugin'

export { qalicoId } from '@tracex/qalico'
export { qalicoOperation } from './migration'
export { qalico as default }

export function createModel (builder: Builder): void {
  createSystemType(
    builder,
    qalico.masterTag.RegulatoryUpdate,
    qalico.icon.Qalico,
    qalico.string.RegulatoryUpdate,
    undefined,
    undefined,
    PaletteColorIndexes.Crocodile
  )

  builder.createDoc(core.class.Attribute, core.space.Model, {
    name: 'date',
    attributeOf: qalico.masterTag.RegulatoryUpdate,
    type: TypeTimestamp(),
    label: qalico.string.Date,
    readonly: true
  })

  builder.createDoc(core.class.Attribute, core.space.Model, {
    name: 'applicable',
    attributeOf: qalico.masterTag.RegulatoryUpdate,
    type: TypeBoolean(),
    label: qalico.string.Applicability,
    readonly: true
  })

  builder.createDoc(core.class.Attribute, core.space.Model, {
    name: 'externalLink',
    attributeOf: qalico.masterTag.RegulatoryUpdate,
    type: TypeString(),
    label: qalico.string.ExternalLink,
    readonly: true
  })

  builder.createDoc(core.class.Attribute, core.space.Model, {
    name: 'qalicoLink',
    attributeOf: qalico.masterTag.RegulatoryUpdate,
    type: TypeString(),
    label: qalico.string.QalicoLink,
    readonly: true
  })

  builder.createDoc(core.class.Attribute, core.space.Model, {
    name: 'owner',
    attributeOf: qalico.masterTag.RegulatoryUpdate,
    type: TypeRef(contact.mixin.Employee),
    label: qalico.string.Owner,
    readonly: true
  })

  builder.createDoc(core.class.Attribute, core.space.Model, {
    name: 'actionsNeeded',
    attributeOf: qalico.masterTag.RegulatoryUpdate,
    type: TypeBoolean(),
    label: qalico.string.ActionsNeeded,
    readonly: true
  })
}
