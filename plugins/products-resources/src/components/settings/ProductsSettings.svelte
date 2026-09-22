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
  import card, { type MasterTag } from '@hcengineering/card'
  import documents, { type DocumentCategory } from '@hcengineering/controlled-documents'
  import core, { type Association, type Class, type Doc, type DocumentUpdate, type Ref } from '@hcengineering/core'
  import setting from '@hcengineering/setting'
  import { ChangeControlMode, DEFAULT_CHANGE_CONTROL_CATEGORY, type ProductsSettings } from '@hcengineering/products'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import {
    Breadcrumb,
    Button,
    ButtonIcon,
    Header,
    IconAdd,
    IconDelete,
    Label,
    RadioButton,
    Scroller,
    SelectPopup,
    SettingsCard,
    SettingsCardsLayout,
    eventToHTMLElement,
    showPopup
  } from '@hcengineering/ui'

  import {
    getAllowedChangeControlAssociations,
    getChangeControlCardClass,
    getChangeControlRelationName,
    getProductVersionCardAssociations,
    updateProductsSettings
  } from '../../change-control'
  import products from '../../plugin'

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const settingsQuery = createQuery()
  const categoriesQuery = createQuery()
  const associationsQuery = createQuery()

  let loading = true
  let settings: ProductsSettings | undefined
  let categories: DocumentCategory[] = []
  let associations: Association[] = []

  settingsQuery.query(products.class.ProductsSettings, {}, (res) => {
    settings = res[0]
    loading = false
  })

  categoriesQuery.query(documents.class.DocumentCategory, {}, (res) => {
    categories = res
  })

  // Keeps relation lists up to date when relations are created or changed
  associationsQuery.query(core.class.Association, {}, (res) => {
    associations = res
  })

  $: mode = settings?.changeControlMode ?? ChangeControlMode.ControlledDocument
  $: categoryRef = settings?.changeControlCategory ?? DEFAULT_CHANGE_CONTROL_CATEGORY
  $: category = categories.find((it) => it._id === categoryRef)
  $: allAssociations = associations !== undefined ? getProductVersionCardAssociations(client) : []
  $: allowed = associations !== undefined ? getAllowedChangeControlAssociations(client, settings) : []
  $: defaultRelation = settings?.defaultChangeControlRelation
  $: available = allAssociations.filter(
    ({ association }) => !allowed.some((it) => it.association._id === association._id)
  )

  async function save (update: DocumentUpdate<ProductsSettings>): Promise<void> {
    await updateProductsSettings(client, settings, update)
  }

  async function setMode (value: ChangeControlMode): Promise<void> {
    if (value === mode) return
    await save({ changeControlMode: value })
  }

  function categoryName (category: DocumentCategory): string {
    return `${category.code} ${category.title}`
  }

  function selectCategory (event: MouseEvent): void {
    const items = categories.map((it) => ({
      id: it._id,
      text: categoryName(it),
      isSelected: it._id === categoryRef
    }))
    showPopup(SelectPopup, { value: items, searchable: true }, eventToHTMLElement(event), async (result) => {
      if (result == null || result === categoryRef) return
      await save({ changeControlCategory: result as Ref<DocumentCategory> })
    })
  }

  async function allowRelation (relation: Ref<Association>): Promise<void> {
    const current = settings?.changeControlRelations ?? []
    if (current.includes(relation)) return
    const relations = [...current, relation]
    const update: DocumentUpdate<ProductsSettings> = { changeControlRelations: relations }
    if (defaultRelation === undefined || !relations.includes(defaultRelation)) {
      update.defaultChangeControlRelation = relation
    }
    await save(update)
  }

  function addRelation (event: MouseEvent): void {
    const items = available.map((it) => ({
      id: it.association._id,
      text: getChangeControlRelationName(it)
    }))
    showPopup(SelectPopup, { value: items, searchable: true }, eventToHTMLElement(event), async (result) => {
      if (result == null) return
      await allowRelation(result as Ref<Association>)
    })
  }

  function getCardClasses (): Array<Ref<Class<Doc>>> {
    return hierarchy.getDescendants(card.class.Card).filter((_class) => {
      if (_class === card.class.Card) return false
      const clazz = hierarchy.getClass(_class)
      return clazz._class !== card.class.MasterTag || (clazz as MasterTag).removed !== true
    })
  }

  function createRelation (): void {
    showPopup(
      setting.component.CreateRelation,
      { aClass: products.class.ProductVersion, _classes: getCardClasses(), exclude: [] },
      undefined,
      async (result) => {
        if (result == null) return
        const relation = result as Ref<Association>
        // Relation might be not usable as change control, e.g. automation only
        const association = await client.findOne(core.class.Association, { _id: relation })
        if (association === undefined || association.automationOnly === true) return
        await allowRelation(relation)
      }
    )
  }

  async function removeRelation (relation: Ref<Association>): Promise<void> {
    const relations = allowed.map((it) => it.association._id).filter((it) => it !== relation)
    const update: DocumentUpdate<ProductsSettings> = { changeControlRelations: relations }
    if (defaultRelation === undefined || !relations.includes(defaultRelation)) {
      if (relations.length > 0) {
        update.defaultChangeControlRelation = relations[0]
      } else {
        update.$unset = { defaultChangeControlRelation: true }
      }
    }
    await save(update)
  }

  async function makeDefault (relation: Ref<Association>): Promise<void> {
    if (relation === defaultRelation) return
    await save({ defaultChangeControlRelation: relation })
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb label={products.string.ProductsSettings} size={'large'} isCurrent />
  </Header>
  <div class="hulyComponent-content__column content">
    {#if !loading}
      <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
        <div class="hulyComponent-content w-full">
          <SettingsCardsLayout columns={1}>
            <SettingsCard label={products.string.ChangeControlMode}>
              <div class="flex-col flex-gap-4">
                <span class="content-dark-color text-sm">
                  <Label label={products.string.ChangeControlModeDescription} />
                </span>

                <div class="flex-row-center flex-gap-4" data-id="products-change-control-mode">
                  <RadioButton
                    group={mode}
                    value={ChangeControlMode.ControlledDocument}
                    labelIntl={documents.string.ControlledDocument}
                    action={async () => {
                      await setMode(ChangeControlMode.ControlledDocument)
                    }}
                  />
                  <RadioButton
                    group={mode}
                    value={ChangeControlMode.Cards}
                    labelIntl={products.string.ChangeControlModeCards}
                    action={async () => {
                      await setMode(ChangeControlMode.Cards)
                    }}
                  />
                </div>
              </div>
            </SettingsCard>

            {#if mode === ChangeControlMode.ControlledDocument}
              <SettingsCard label={products.string.ChangeControlCategory}>
                <div class="flex-col flex-gap-4">
                  <span class="content-dark-color text-sm">
                    <Label label={products.string.ChangeControlCategoryDescription} />
                  </span>
                  <div data-id="products-change-control-category">
                    <Button kind={'regular'} size={'medium'} on:click={selectCategory}>
                      <div slot="content">
                        {#if category !== undefined}
                          {categoryName(category)}
                        {:else}
                          {categoryRef}
                        {/if}
                      </div>
                    </Button>
                  </div>
                </div>
              </SettingsCard>
            {:else}
              <SettingsCard label={products.string.ChangeControlRelations}>
                <svelte:fragment slot="actions">
                  <div class="flex-row-center flex-gap-2">
                    <Button
                      label={products.string.AddChangeControlRelation}
                      kind={'regular'}
                      size={'medium'}
                      disabled={available.length === 0}
                      on:click={addRelation}
                    />
                    <Button
                      icon={IconAdd}
                      label={products.string.CreateChangeControlRelation}
                      kind={'primary'}
                      size={'medium'}
                      on:click={createRelation}
                    />
                  </div>
                </svelte:fragment>
                <div class="flex-col flex-gap-4" data-id="products-change-control-relations">
                  <span class="content-dark-color text-sm">
                    <Label label={products.string.ChangeControlRelationsDescription} />
                  </span>

                  {#if allowed.length === 0}
                    <span class="text-sm error-color">
                      <Label label={products.string.NoChangeControlRelations} />
                    </span>
                  {:else}
                    <div class="flex-col flex-gap-2">
                      {#each allowed as item (item.association._id)}
                        {@const relation = item.association._id}
                        <div class="flex-between flex-gap-4 relation-row">
                          <div class="flex-row-center flex-gap-2 min-w-0">
                            <span class="overflow-label">{getChangeControlRelationName(item)}</span>
                            <span class="content-dark-color text-sm overflow-label">
                              <Label label={hierarchy.getClass(getChangeControlCardClass(item)).label} />
                            </span>
                          </div>
                          <div class="flex-row-center flex-gap-2 flex-no-shrink">
                            {#if relation === defaultRelation}
                              <span class="content-dark-color text-sm">
                                <Label label={products.string.DefaultChangeControlRelation} />
                              </span>
                            {:else}
                              <Button
                                label={products.string.MakeDefault}
                                kind={'ghost'}
                                size={'small'}
                                on:click={async () => {
                                  await makeDefault(relation)
                                }}
                              />
                            {/if}
                            <ButtonIcon
                              icon={IconDelete}
                              kind={'tertiary'}
                              size={'small'}
                              on:click={async () => {
                                await removeRelation(relation)
                              }}
                            />
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              </SettingsCard>
            {/if}
          </SettingsCardsLayout>
        </div>
      </Scroller>
    {/if}
  </div>
</div>

<style lang="scss">
  .relation-row {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
  }
</style>
