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
  import documents from '@hcengineering/controlled-documents'
  import { type Association, type Ref } from '@hcengineering/core'
  import { type Product } from '@hcengineering/products'
  import { getClient } from '@hcengineering/presentation'
  import {
    Button,
    Label,
    Section,
    SelectPopup,
    type SelectPopupValueType,
    eventToHTMLElement,
    showPopup
  } from '@hcengineering/ui'

  import { getProductVersionCardAssociations } from '../../change-control'
  import products from '../../plugin'

  export let object: Product
  export let readonly: boolean = false

  const CONTROLLED_DOCUMENT = 'products:change-control:controlled-document'
  const client = getClient()
  let selectedRelation: Ref<Association> | undefined

  $: syncRelation(object)
  $: associations = getProductVersionCardAssociations(client)
  $: selected = associations.find(({ association }) => association._id === selectedRelation)

  function syncRelation (product: Product): void {
    selectedRelation = product.changeControlRelation
  }

  function relationName (association: Association, direction: 'A' | 'B'): string {
    return direction === 'B' ? association.nameB : association.nameA
  }

  async function updateRelation (relation: Ref<Association> | undefined): Promise<void> {
    if (readonly || relation === selectedRelation) return

    const previous = selectedRelation
    selectedRelation = relation

    try {
      if (relation === undefined) {
        await client.updateDoc(products.class.Product, object.space, object._id, {
          $unset: { changeControlRelation: true }
        })
      } else {
        await client.updateDoc(products.class.Product, object.space, object._id, { changeControlRelation: relation })
      }
    } catch (error) {
      selectedRelation = previous
      throw error
    }
  }

  function open (event: MouseEvent): void {
    if (readonly) return

    const items: SelectPopupValueType[] = [
      {
        id: CONTROLLED_DOCUMENT,
        label: documents.string.ControlledDocument,
        isSelected: selectedRelation === undefined
      },
      ...associations.map(({ association, direction }) => ({
        id: association._id,
        text: relationName(association, direction),
        isSelected: association._id === selectedRelation
      }))
    ]

    showPopup(SelectPopup, { value: items, searchable: true }, eventToHTMLElement(event), async (result) => {
      if (result === undefined) return
      const relation = result === CONTROLLED_DOCUMENT ? undefined : (result as Ref<Association>)
      await updateRelation(relation)
    })
  }
</script>

<Section label={products.string.ChangeControl}>
  <svelte:fragment slot="content">
    <Button width={'100%'} disabled={readonly} on:click={open}>
      <div slot="content">
        {#if selectedRelation === undefined}
          <Label label={documents.string.ControlledDocument} />
        {:else if selected !== undefined}
          {relationName(selected.association, selected.direction)}
        {:else}
          <Label label={products.string.ChangeControl} />
        {/if}
      </div>
    </Button>
  </svelte:fragment>
</Section>
