<!--
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
-->
<script lang="ts">
  import core, { getCurrentAccount, type Doc, type DocumentQuery, type Ref, type Relation } from '@hcengineering/core'
  import documents, { DocumentState, type Document } from '@hcengineering/controlled-documents'
  import { checkMyPermission, permissionsStore } from '@hcengineering/contact-resources'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import type { Product, ProductVersion } from '@hcengineering/products'
  import { ButtonKind, ButtonSize } from '@hcengineering/ui'
  import { ObjectBox, buildRelationCandidatesQuery, getRelationCandidatesClass } from '@hcengineering/view-resources'

  import {
    canChangeProductVersionChangeControl,
    getProductVersionCardAssociation,
    getProductVersionRelationQuery,
    getRelatedCard,
    type ProductVersionCardAssociation
  } from '../../change-control'
  import products from '../../plugin'

  export let object: ProductVersion
  export let value: Ref<Document> | undefined = undefined
  export let readonly: boolean = false
  export let kind: ButtonKind = 'link'
  export let size: ButtonSize = 'large'
  export let justify: 'left' | 'center' = 'left'
  export let width: string | undefined = '100%'

  const client = getClient()
  const productQuery = createQuery()
  const versionsQuery = createQuery()
  const relationsQuery = createQuery()

  let product: Product | undefined
  let usedChangeControls: Array<Ref<Document>> = []
  let relations: Relation[] = []
  let cardQuery: DocumentQuery<Doc> = {}
  let cardQueryRequest = 0

  $: productQuery.query(products.class.Product, { _id: object.space }, (res) => {
    product = res[0]
  })

  $: association = resolveAssociation(product)
  $: isCardMode = product?.changeControlRelation !== undefined

  $: canChange =
    !readonly &&
    canChangeProductVersionChangeControl(
      object,
      product,
      getCurrentAccount().uuid,
      checkMyPermission(core.permission.UpdateSpace, object.space, $permissionsStore)
    )

  // Controlled document: a document can be the change control of one version only.
  $: if (!isCardMode && canChange) {
    versionsQuery.query(products.class.ProductVersion, { space: object.space }, (res) => {
      usedChangeControls = res
        .filter((it) => it._id !== object._id)
        .map((it) => it.changeControl)
        .filter((it): it is Ref<Document> => it !== undefined)
    })
  } else {
    versionsQuery.unsubscribe()
    usedChangeControls = []
  }

  // Card: the change control is a relation of the configured association.
  $: if (association !== undefined) {
    relationsQuery.query(core.class.Relation, getProductVersionRelationQuery(association, object._id), (res) => {
      relations = res
    })
  } else {
    relationsQuery.unsubscribe()
    relations = []
  }

  $: card = association !== undefined && relations.length > 0 ? getRelatedCard(association, relations[0]) : undefined
  $: if (canChange) void updateCardQuery(association, card)

  function resolveAssociation (product: Product | undefined): ProductVersionCardAssociation | undefined {
    if (product?.changeControlRelation === undefined) return undefined
    return getProductVersionCardAssociation(client, product.changeControlRelation)
  }

  async function updateCardQuery (
    association: ProductVersionCardAssociation | undefined,
    current: Ref<Doc> | undefined
  ): Promise<void> {
    const request = ++cardQueryRequest
    if (association === undefined) {
      cardQuery = {}
      return
    }
    const excluded = new Set<Ref<Doc>>(current !== undefined ? [current] : [])
    const { type } = association.association
    if (type === '1:1' || (type === '1:N' && association.direction === 'B')) {
      // The card can be linked to one product version only.
      const used = await client.findAll(core.class.Relation, { association: association.association._id })
      for (const relation of used) excluded.add(getRelatedCard(association, relation))
    }
    try {
      const query = await buildRelationCandidatesQuery(association.association, association.direction, [...excluded])
      if (request === cardQueryRequest) cardQuery = query
    } catch {
      if (request === cardQueryRequest) cardQuery = {}
    }
  }

  async function changeDocument (next: Ref<Document> | null | undefined): Promise<void> {
    if (!canChange || next == null || next === value) return
    await client.updateDoc(products.class.ProductVersion, object.space, object._id, { changeControl: next })
  }

  async function changeCard (next: Ref<Doc> | null | undefined): Promise<void> {
    if (!canChange || association === undefined || next == null || next === card) return
    const ops = client.apply(undefined, 'product-version-change-control')
    for (const relation of relations) {
      await ops.remove(relation)
    }
    await ops.createDoc(core.class.Relation, core.space.Workspace, {
      association: association.association._id,
      docA: association.direction === 'B' ? object._id : next,
      docB: association.direction === 'B' ? next : object._id
    })
    await ops.commit()
  }
</script>

{#if !isCardMode}
  <ObjectBox
    {value}
    _class={documents.class.Document}
    docQuery={{
      space: object.space,
      // TODO Use more robust category id
      category: 'documents:category:DOC - CC',
      state: DocumentState.Effective
    }}
    docProps={{
      withTitle: true,
      isRegular: true,
      disableLink: true
    }}
    searchField="code"
    excluded={usedChangeControls}
    label={products.string.ChangeControl}
    showNavigate={false}
    readonly={!canChange}
    {kind}
    {size}
    {justify}
    {width}
    on:change={(e) => changeDocument(e.detail)}
  />
{:else if association !== undefined}
  <ObjectBox
    value={card}
    _class={getRelationCandidatesClass(association.association, association.direction)}
    docQuery={cardQuery}
    docProps={{ type: 'text' }}
    searchField="title"
    label={products.string.ChangeControl}
    showNavigate={false}
    readonly={!canChange}
    {kind}
    {size}
    {justify}
    {width}
    on:change={(e) => changeCard(e.detail)}
  />
{/if}
