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

import type { AnyAttribute, Class, Doc, Hierarchy, Ref, VersionableDoc } from '@hcengineering/core'
import type { AttributeModel } from '@hcengineering/view'

interface ObjectWithReadonlyFields extends VersionableDoc {
  readonlyFields?: string[]
  readonlySections?: Array<Ref<Class<Doc>>>
}

interface ReadonlyAttribute extends Pick<AttributeModel, 'key' | 'castRequest'> {
  attribute?: Pick<AnyAttribute, 'attributeOf'>
}

/** Checks object, field and section locks, including mixin and relationship fields. */
export function isObjectAttributeReadonly (
  object: ObjectWithReadonlyFields,
  attribute: ReadonlyAttribute,
  hierarchy: Pick<Hierarchy, 'isMixin' | 'getAncestors'>
): boolean {
  let key = attribute.key
  if (attribute.castRequest !== undefined && key.startsWith(`${attribute.castRequest}.`)) {
    key = key.substring(attribute.castRequest.length + 1)
  }
  if (key.startsWith('$associations.')) {
    const parts = key.split('.')
    key = parts.slice(parts.lastIndexOf('$associations') + 2).join('.')
  }
  if (object.readonly === true || object.readonlyFields?.includes(key) === true) return true
  const sections = object.readonlySections
  if (sections === undefined || sections.length === 0) return false

  const section = attribute.castRequest ?? attribute.attribute?.attributeOf
  if (section !== undefined && hierarchy.isMixin(section)) {
    return sections.includes(section)
  }
  return hierarchy.getAncestors(object._class).some((ancestor) => sections.includes(ancestor))
}
