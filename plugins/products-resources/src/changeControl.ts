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

import core, { type Association, type Doc, type DocumentQuery, type Ref } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import { type Filter } from '@hcengineering/view'
import { filtersToQuery } from '@hcengineering/view-resources'
import card, { type Card } from '@hcengineering/card'
import products from '@hcengineering/products'

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
