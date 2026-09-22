<!--
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
-->
<script lang="ts">
  import documents from '@hcengineering/controlled-documents'
  import { type Association, type DocumentUpdate, type Ref } from '@hcengineering/core'
  import { ChangeControlMode, type Product, type ProductsSettings } from '@hcengineering/products'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import {
    Button,
    Label,
    Section,
    SelectPopup,
    type SelectPopupValueType,
    eventToHTMLElement,
    showPopup,
    themeStore
  } from '@hcengineering/ui'

  import {
    type ResolvedChangeControl,
    getAllowedChangeControlAssociations,
    getChangeControlRelationName,
    resolveProductChangeControl
  } from '../../change-control'
  import products from '../../plugin'

  export let object: Product
  export let readonly: boolean = false

  const WORKSPACE_DEFAULT = 'products:change-control:workspace-default'
  const CONTROLLED_DOCUMENT = 'products:change-control:controlled-document'

  const client = getClient()
  const settingsQuery = createQuery()

  let settings: ProductsSettings | undefined
  settingsQuery.query(products.class.ProductsSettings, {}, (res) => {
    settings = res[0]
  })

  $: allowed = getAllowedChangeControlAssociations(client, settings)
  $: resolved = resolveProductChangeControl(client, object, settings)
  $: workspaceResolved = resolveProductChangeControl(client, undefined, settings)
  $: selectedId = getSelectedId(object)

  function getSelectedId (product: Product): string {
    if (product.changeControlMode === undefined) return WORKSPACE_DEFAULT
    if (product.changeControlMode === ChangeControlMode.ControlledDocument) return CONTROLLED_DOCUMENT
    return product.changeControlRelation ?? ''
  }

  async function describe (value: ResolvedChangeControl): Promise<string> {
    if (value.mode === ChangeControlMode.ControlledDocument) {
      return await translate(documents.string.ControlledDocument, {}, $themeStore.language)
    }
    if (value.association !== undefined) return getChangeControlRelationName(value.association)
    return await translate(products.string.ChangeControlNotConfigured, {}, $themeStore.language)
  }

  async function updateProduct (id: string): Promise<void> {
    if (readonly || id === selectedId) return

    let update: DocumentUpdate<Product>
    if (id === WORKSPACE_DEFAULT) {
      update = { $unset: { changeControlMode: true, changeControlRelation: true } }
    } else if (id === CONTROLLED_DOCUMENT) {
      update = { changeControlMode: ChangeControlMode.ControlledDocument, $unset: { changeControlRelation: true } }
    } else {
      update = { changeControlMode: ChangeControlMode.Cards, changeControlRelation: id as Ref<Association> }
    }

    await client.updateDoc(products.class.Product, object.space, object._id, update)
  }

  async function open (event: MouseEvent): Promise<void> {
    if (readonly) return

    const target = eventToHTMLElement(event)
    const workspaceDefault = await translate(products.string.WorkspaceDefault, {}, $themeStore.language)
    const items: SelectPopupValueType[] = [
      {
        id: WORKSPACE_DEFAULT,
        text: `${workspaceDefault} (${await describe(workspaceResolved)})`,
        isSelected: selectedId === WORKSPACE_DEFAULT
      },
      {
        id: CONTROLLED_DOCUMENT,
        label: documents.string.ControlledDocument,
        isSelected: selectedId === CONTROLLED_DOCUMENT
      },
      ...allowed.map((association) => ({
        id: association.association._id,
        text: getChangeControlRelationName(association),
        isSelected: association.association._id === selectedId
      }))
    ]

    showPopup(SelectPopup, { value: items, searchable: true }, target, async (result) => {
      if (result === undefined || result === null) return
      await updateProduct(result as string)
    })
  }
</script>

<Section label={products.string.ChangeControl}>
  <svelte:fragment slot="content">
    <Button
      width={'100%'}
      disabled={readonly}
      on:click={(event) => {
        void open(event)
      }}
    >
      <div
        slot="content"
        class:error-color={resolved.mode === ChangeControlMode.Cards && resolved.association === undefined}
      >
        {#if resolved.inherited}
          <Label label={products.string.WorkspaceDefault} />:
        {/if}
        {#if resolved.mode === ChangeControlMode.ControlledDocument}
          <Label label={documents.string.ControlledDocument} />
        {:else if resolved.association !== undefined}
          {getChangeControlRelationName(resolved.association)}
        {:else}
          <Label label={products.string.ChangeControlNotConfigured} />
        {/if}
      </div>
    </Button>
  </svelte:fragment>
</Section>
