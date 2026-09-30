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

import type { VersionableDoc } from '@hcengineering/core'
import type { AttributeModel } from '@hcengineering/view'

interface ObjectWithReadonlyFields extends VersionableDoc {
  readonlyFields?: string[]
}

/** Checks object and field locks, including mixin and relationship fields. */
export function isObjectAttributeReadonly (
  object: ObjectWithReadonlyFields,
  attribute: Pick<AttributeModel, 'key' | 'castRequest'>
): boolean {
  let key = attribute.castRequest ? attribute.key.substring(attribute.castRequest.length + 1) : attribute.key
  if (key.startsWith('$associations.')) {
    const parts = key.split('.')
    key = parts.slice(parts.lastIndexOf('$associations') + 2).join('.')
  }
  return object.readonly === true || object.readonlyFields?.includes(key) === true
}
