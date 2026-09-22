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
import { type DocumentCategory } from '@hcengineering/controlled-documents'
import core, {
  type Association,
  type Class,
  type Client,
  type Data,
  type Doc,
  type DocumentUpdate,
  type Ref,
  type TxOperations
} from '@hcengineering/core'
import products, {
  ChangeControlMode,
  DEFAULT_CHANGE_CONTROL_CATEGORY,
  type Product,
  type ProductsSettings
} from '@hcengineering/products'

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

export function getChangeControlRelationName ({ association, direction }: ProductVersionCardAssociation): string {
  return direction === 'B' ? association.nameB : association.nameA
}

export function getChangeControlCardClass ({ association, direction }: ProductVersionCardAssociation): Ref<Class<Doc>> {
  return direction === 'B' ? association.classB : association.classA
}

/** Returns product version to card relations allowed as change control in the workspace settings. */
export function getAllowedChangeControlAssociations (
  client: Client,
  settings: ProductsSettings | undefined
): ProductVersionCardAssociation[] {
  const allowed = settings?.changeControlRelations ?? []
  if (allowed.length === 0) return []

  const associations = getProductVersionCardAssociations(client)
  const result: ProductVersionCardAssociation[] = []
  for (const relation of allowed) {
    const association = associations.find((it) => it.association._id === relation)
    if (association !== undefined) result.push(association)
  }
  return result
}

export interface ResolvedChangeControl {
  mode: ChangeControlMode
  // True when the product uses the workspace settings
  inherited: boolean
  // Category of controlled documents used in ControlledDocument mode
  category: Ref<DocumentCategory>
  // Relation used in Cards mode, undefined when change control is not configured
  association?: ProductVersionCardAssociation
}

/** Resolves the effective product change control: product override first, then workspace settings. */
export function resolveProductChangeControl (
  client: Client,
  product: Pick<Product, 'changeControlMode' | 'changeControlRelation'> | undefined,
  settings: ProductsSettings | undefined
): ResolvedChangeControl {
  const inherited = product?.changeControlMode === undefined
  const mode = product?.changeControlMode ?? settings?.changeControlMode ?? ChangeControlMode.ControlledDocument
  const category = settings?.changeControlCategory ?? DEFAULT_CHANGE_CONTROL_CATEGORY

  if (mode !== ChangeControlMode.Cards) {
    return { mode, inherited, category }
  }

  const relation = inherited ? settings?.defaultChangeControlRelation : product?.changeControlRelation
  const association =
    relation !== undefined
      ? getAllowedChangeControlAssociations(client, settings).find((it) => it.association._id === relation)
      : undefined

  return { mode, inherited, category, association }
}

/** Updates the workspace products settings, creating the settings document when it does not exist yet. */
export async function updateProductsSettings (
  client: TxOperations,
  settings: ProductsSettings | undefined,
  update: DocumentUpdate<ProductsSettings>
): Promise<void> {
  if (settings === undefined) {
    const data: Record<string, any> = { ...update }
    delete data.$unset
    await client.createDoc(products.class.ProductsSettings, core.space.Workspace, {
      ...(data as Partial<Data<ProductsSettings>>),
      enabled: true
    })
    return
  }

  await client.updateDoc(products.class.ProductsSettings, settings.space, settings._id, update)
}
