//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import card from '@hcengineering/card'
import core, { type Association, type Class, type Client, type Doc, type Ref } from '@hcengineering/core'
import products from '@hcengineering/products'

export interface ProductVersionCardAssociation {
  association: Association
  direction: 'A' | 'B'
}

function isCardClass (client: Client, _class: Ref<Class<Doc>>): boolean {
  try {
    return client.getHierarchy().isDerived(_class, card.class.Card)
  } catch {
    return false
  }
}

/** Returns manually editable relations between product versions and cards. */
export function getProductVersionCardAssociations (client: Client): ProductVersionCardAssociation[] {
  const hierarchy = client.getHierarchy()
  const productVersionClasses = new Set<Ref<Class<Doc>>>([
    products.class.ProductVersion,
    ...hierarchy.getAncestors(products.class.ProductVersion)
  ])
  const result: ProductVersionCardAssociation[] = []

  for (const association of client.getModel().findAllSync(core.class.Association, {})) {
    if (association.automationOnly === true) continue

    if (
      productVersionClasses.has(association.classA) &&
      association.nameB.trim().length > 0 &&
      isCardClass(client, association.classB)
    ) {
      result.push({ association, direction: 'B' })
    } else if (
      productVersionClasses.has(association.classB) &&
      association.nameA.trim().length > 0 &&
      isCardClass(client, association.classA)
    ) {
      result.push({ association, direction: 'A' })
    }
  }

  return result
}

export function getProductVersionCardAssociation (
  client: Client,
  association: Ref<Association>
): ProductVersionCardAssociation | undefined {
  return getProductVersionCardAssociations(client).find((candidate) => candidate.association._id === association)
}
