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

import contact, { type Person } from '@hcengineering/contact'
import core, {
  type ArrOf,
  type Doc,
  type PersonId,
  type Ref,
  type RefTo,
  type Tx,
  type TxCreateDoc,
  type TxCUD,
  type TxMixin,
  type TxUpdateDoc
} from '@hcengineering/core'
import type { NotificationType } from '@hcengineering/notification'
import type { TriggerControl } from '@hcengineering/server-core'

/** Matches employee references assigned or pushed by the current transaction. */
export function isUserAddedToEmployeeFieldTypeMatch (
  tx: Tx,
  doc: Doc,
  person: Ref<Person>,
  _socialIds: PersonId[],
  type: NotificationType,
  control: TriggerControl
): boolean {
  const cud = tx as TxCUD<Doc>
  if (cud.objectId !== doc._id) return false
  const { hierarchy } = control
  let values: Record<string, unknown>
  if (tx._class === core.class.TxCreateDoc || tx._class === core.class.TxMixin) {
    values = (tx as TxCreateDoc<Doc> | TxMixin<Doc, Doc>).attributes as Record<string, unknown>
  } else if (tx._class === core.class.TxUpdateDoc) {
    values = (tx as TxUpdateDoc<Doc>).operations as Record<string, unknown>
  } else {
    return false
  }
  const clazz = tx._class === core.class.TxMixin ? (tx as TxMixin<Doc, Doc>).mixin : cud.objectClass
  for (const [field, attribute] of hierarchy.getAllAttributes(clazz)) {
    if (type.field !== undefined && type.field !== field) continue
    const fieldType =
      attribute.type._class === core.class.ArrOf ? (attribute.type as ArrOf<RefTo<Doc>>).of : attribute.type
    if (
      fieldType._class !== core.class.RefTo ||
      !hierarchy.isDerived((fieldType as RefTo<Doc>).to, contact.mixin.Employee)
    ) {
      continue
    }
    let value = values[field] ?? (values.$push as Record<string, unknown> | undefined)?.[field]
    if (typeof value === 'object' && value !== null && '$each' in value) value = value.$each
    if (value === person || (Array.isArray(value) && value.includes(person))) return true
  }
  return false
}
