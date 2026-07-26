//
// Copyright © 2024 Hardcore Engineering Inc.
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

import core, {
  type Association,
  type WithLookup,
  type Client,
  type Doc,
  type DocumentQuery,
  type Ref,
  type Space,
  checkPermission,
  getCurrentAccount
} from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import { showPopup } from '@hcengineering/ui'
import { type Filter, type KeyFilter } from '@hcengineering/view'
import { filtersToQuery } from '@hcengineering/view-resources'
import card, { type Card } from '@hcengineering/card'
import documents from '@hcengineering/controlled-documents'
import products, { ProductVersionState, type Product, type ProductVersion } from '@hcengineering/products'

import CreateProductVersion from './components/product-version/CreateProductVersion.svelte'

/** Well-known `CardRelation.purpose` marker for change-control card relations of product versions. */
export const ChangeControlPurpose = 'changeControl'

/**
 * Class-level change-control card associations configured for product versions: platform
 * associations `ProductVersion → <card MasterTag>` marked with the `CardRelation` mixin and
 * `purpose === 'changeControl'`.
 */
export function getChangeControlAssociations (): Association[] {
  const client = getClient()
  const hierarchy = client.getHierarchy()
  return client
    .getModel()
    .findAllSync(core.class.Association, { classA: products.class.ProductVersion })
    .filter(
      (a) =>
        hierarchy.hasMixin(a, card.mixin.CardRelation) &&
        hierarchy.as(a, card.mixin.CardRelation).purpose === ChangeControlPurpose
    )
}

/**
 * Builds the query of cards eligible for a change-control association: the association's card
 * type ({@link Association.classB}) narrowed by the mixin `filter` and, unless disabled via
 * `requireLatest`, the latest card version.
 */
export async function buildCardRelationQuery (
  association: Association,
  excluded: Array<Ref<Card>> = []
): Promise<DocumentQuery<Card>> {
  const client = getClient()
  const hierarchy = client.getHierarchy()
  const rel = hierarchy.hasMixin(association, card.mixin.CardRelation)
    ? hierarchy.as(association, card.mixin.CardRelation)
    : undefined
  const isVersionable = hierarchy.classHierarchyMixin(association.classB, core.mixin.VersionableClass) !== undefined
  const requireLatest = rel?.requireLatest !== false

  let query: DocumentQuery<Doc> = excluded.length > 0 ? { _id: { $nin: excluded } } : {}
  if (isVersionable && requireLatest) {
    query = { isLatest: true, ...query }
  }
  if (rel?.filter != null && rel.filter !== '') {
    try {
      query = await filtersToQuery(JSON.parse(rel.filter) as Filter[], query)
    } catch (e) {
      console.error('Failed to apply change control card filter', e)
    }
  }
  return query as DocumentQuery<Card>
}

export function getProductVersionVersion (doc: ProductVersion): string {
  const codename = doc.codename ?? ''
  const version = `${doc.major}.${doc.minor}.${doc.patch}`

  return codename !== '' ? `${version} ${codename}` : version
}

export function getProductVersionName (doc: ProductVersion, product: Product): string {
  const version = getProductVersionVersion(doc)
  return `${product.name} ${version}`
}

export async function getVisibleFilters (filters: KeyFilter[], space?: Ref<Space>): Promise<KeyFilter[]> {
  return filters.filter((f) => f.key !== core.role.Admin)
}

export async function canEditProduct (doc?: Product): Promise<boolean> {
  if (doc === null || doc === undefined) {
    return false
  }

  if ((doc.owners ?? []).includes(getCurrentAccount().uuid)) {
    return true
  }

  const client = getClient()

  if (await checkPermission(client, core.permission.UpdateObject, core.space.Space)) {
    return true
  }

  if (await checkPermission(client, core.permission.UpdateSpace, doc._id)) {
    return true
  }

  return false
}

export async function canEditProductVersion (doc?: WithLookup<ProductVersion>): Promise<boolean> {
  if (doc === null || doc === undefined) {
    return false
  }

  if (doc.state === ProductVersionState.Released) {
    return false
  }

  const product = await getClient().findOne(products.class.Product, { _id: doc.space })
  if (product === undefined) {
    return false
  }
  return await canEditProduct(product)
}

export async function canCreateProductVersion (doc?: Product | Product[]): Promise<boolean> {
  if (doc === null || doc === undefined) {
    return false
  }

  if (Array.isArray(doc)) {
    return false
  }

  if (doc.archived) {
    return false
  }

  return await canEditProduct(doc)
}

export async function createProductVersion (doc?: Product | Product[]): Promise<void> {
  if (doc === null || doc === undefined) {
    return
  }

  const product = Array.isArray(doc) ? doc[0] : doc
  if (product === undefined) {
    return
  }

  showPopup(CreateProductVersion, { space: product._id }, 'top')
}

export async function canDeleteProductVersion (doc?: ProductVersion | ProductVersion[]): Promise<boolean> {
  if (doc === null || doc === undefined) {
    return false
  }

  if (Array.isArray(doc)) {
    return false
  }

  if (doc.state === ProductVersionState.Released) {
    return false
  }

  const client = getClient()

  const anychild = await client.findOne(products.class.ProductVersion, { parent: doc._id })
  if (anychild !== undefined) {
    return false
  }

  const anydoc = await client.findOne(documents.class.ProjectDocument, { project: doc._id, initial: doc._id })
  if (anydoc !== undefined) {
    return false
  }

  const product = await client.findOne(products.class.Product, { _id: doc.space })
  if (product !== undefined) {
    return await canEditProduct(product)
  }

  return false
}

export async function productIdentifierProvider (client: Client, ref: Ref<Product>, doc?: Product): Promise<string> {
  const object = doc ?? (await client.findOne(products.class.Product, { _id: ref }))

  if (object === undefined) {
    return ''
  }

  return object.name
}
