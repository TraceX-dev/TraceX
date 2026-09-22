<!--
//
// Copyright © 2024 Hardcore Engineering Inc.
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
-->

<script lang="ts">
  import { deepEqual } from 'fast-equals'
  import { createEventDispatcher } from 'svelte'

  import documents, {
    Document,
    DocumentState,
    copyProjectDocuments,
    deleteProjectDrafts
  } from '@hcengineering/controlled-documents'
  import {
    ChangeControlMode,
    Product,
    ProductVersion,
    ProductVersionState,
    type ProductsSettings
  } from '@hcengineering/products'
  import {
    SortingOrder,
    generateId,
    type Association,
    type Data,
    type Doc,
    type DocumentQuery,
    type Ref
  } from '@hcengineering/core'
  import { Card, MessageBox, SpaceSelector, createQuery, getClient } from '@hcengineering/presentation'
  import { StyledTextBox } from '@hcengineering/text-editor-resources'
  import { DropdownLabelsIntl, EditBox, FocusHandler, Label, createFocusManager, showPopup } from '@hcengineering/ui'
  import {
    ObjectBox,
    buildRelationCandidatesQuery,
    commitPendingRelations,
    getRelationCandidatesClass
  } from '@hcengineering/view-resources'

  import {
    resolveProductChangeControl,
    type ProductVersionCardAssociation,
    type ResolvedChangeControl
  } from '../../change-control'
  import products from '../../plugin'

  type Severity = 'major' | 'minor' | 'patch'
  type ProductVersionDraft = Omit<Data<ProductVersion>, 'parent' | 'name'>

  export let space: Ref<Product> | undefined

  const dispatch = createEventDispatcher()
  const client = getClient()
  const query = createQuery()
  const productQuery = createQuery()
  const settingsQuery = createQuery()
  const manager = createFocusManager()

  const id: Ref<ProductVersion> = generateId()

  let object: Omit<Data<ProductVersion>, 'parent' | 'name'> = createDefaultObject()
  let excludedChangeControl: Array<Ref<Document>> = []

  let parent: ProductVersion | null | undefined
  let product: Product | undefined
  let settings: ProductsSettings | undefined
  let severity: Severity = 'minor'

  let changeControlCard: Ref<Doc> | undefined
  let changeControlCardQuery: DocumentQuery<Doc> = {}
  let previousChangeControlRelation: Ref<Association> | undefined
  let changeControlQueryRequest = 0
  let previousSpace = space

  $: if (space !== previousSpace) {
    previousSpace = space
    product = undefined
    object.changeControl = undefined
    changeControlCard = undefined
  }

  settingsQuery.query(products.class.ProductsSettings, {}, (res) => {
    settings = res[0]
  })

  $: if (space !== undefined) {
    productQuery.query(products.class.Product, { _id: space }, (res) => {
      product = res[0]
    })
  } else {
    productQuery.unsubscribe()
    product = undefined
  }

  $: query.query(
    products.class.ProductVersion,
    {
      space
    },
    (res) => {
      parent = res[0] ?? null
      excludedChangeControl = res.map((p) => p.changeControl).filter((p) => p !== undefined)
    },
    {
      sort: {
        createdOn: SortingOrder.Descending
      }
    }
  )

  $: updateSeverity(parent, severity)
  $: changeControl = resolveProductChangeControl(client, product, settings)
  $: changeControlAssociation = changeControl.association
  $: void updateChangeControlCardOptions(changeControlAssociation)

  async function updateChangeControlCardOptions (association: ProductVersionCardAssociation | undefined): Promise<void> {
    const relation = association?.association._id
    if (relation !== previousChangeControlRelation) {
      previousChangeControlRelation = relation
      changeControlCard = undefined
    }

    const request = ++changeControlQueryRequest
    if (association === undefined) {
      changeControlCardQuery = {}
      return
    }

    try {
      const query = await buildRelationCandidatesQuery(association.association, association.direction)
      if (request === changeControlQueryRequest) {
        changeControlCardQuery = query
      }
    } catch {
      if (request === changeControlQueryRequest) {
        changeControlCardQuery = {}
      }
    }
  }

  function updateSeverity (parent: ProductVersion | null | undefined, severity: Severity): void {
    if (parent != null) {
      object.major = severity === 'major' ? parent.major + 1 : parent.major
      object.minor = severity === 'minor' ? parent.minor + 1 : 0
      object.patch = severity === 'patch' ? parent.patch + 1 : 0
    } else {
      object.major = 1
      object.minor = 0
      object.patch = 0
    }
  }

  function formatProductVersion (object: ProductVersionDraft): string {
    return `${object.major}.${object.minor}.${object.patch}`
  }

  function formatProductVersionName (object: ProductVersionDraft): string {
    return `${formatProductVersion(object)}` + (object.codename != null ? ` ${object.codename}` : '')
  }

  async function handleOkAction (): Promise<void> {
    if (space === undefined || product === undefined) {
      return
    }

    const ops = client.apply()

    const version = {
      ...object,
      changeControl: changeControl.mode === ChangeControlMode.ControlledDocument ? object.changeControl : undefined,
      parent: parent?._id ?? products.ids.NoParentVersion,
      name: formatProductVersionName(object)
    }

    if (version.parent !== products.ids.NoParentVersion && version.parent !== undefined) {
      await ops.updateDoc(products.class.ProductVersion, space, version.parent, {
        readonly: true,
        state: ProductVersionState.Released
      })
    }

    await ops.createDoc(products.class.ProductVersion, space, version, id)
    await deleteProjectDrafts(ops, version.parent)
    await copyProjectDocuments(ops, version.parent, id)

    const changeControlRelations =
      changeControlAssociation !== undefined && changeControlCard !== undefined
        ? [
            {
              association: changeControlAssociation.association._id,
              direction: changeControlAssociation.direction,
              doc: changeControlCard
            }
          ]
        : []
    await commitPendingRelations(ops, id, changeControlRelations)

    await ops.commit()

    object = createDefaultObject()
    changeControlCard = undefined
    dispatch('close', id)
  }

  async function handleClose (): Promise<void> {
    const noChanges = deepEqual(object, createDefaultObject())
    if (noChanges) {
      dispatch('close')
    } else {
      showPopup(
        MessageBox,
        {
          label: products.string.CreateDialogClose,
          message: products.string.CreateDialogCloseNote
        },
        'top',
        (result?: boolean) => {
          if (result === true) {
            dispatch('close')
          }
        }
      )
    }
  }

  function createDefaultObject (): ProductVersionDraft {
    return {
      readonly: false,
      major: 1,
      minor: 0,
      patch: 0,
      codename: '',
      description: '',
      state: ProductVersionState.Active
    }
  }

  function hasChangeControl (
    changeControl: ResolvedChangeControl,
    document: Ref<Document> | undefined,
    card: Ref<Doc> | undefined
  ): boolean {
    if (changeControl.mode === ChangeControlMode.ControlledDocument) return document !== undefined
    return changeControl.association !== undefined && card !== undefined
  }

  $: canSave =
    space !== undefined &&
    product !== undefined &&
    parent !== undefined &&
    object.major !== undefined &&
    object.major >= 0 &&
    object.minor !== undefined &&
    object.minor >= 0 &&
    object.patch !== undefined &&
    object.patch >= 0 &&
    (parent == null || hasChangeControl(changeControl, object.changeControl, changeControlCard))
</script>

<FocusHandler {manager} />

<Card
  label={products.string.CreateProductVersion}
  okAction={handleOkAction}
  {canSave}
  on:close={handleClose}
  hideAttachments
>
  <svelte:fragment slot="header">
    <SpaceSelector
      bind:space
      _class={products.class.Product}
      label={products.string.Product}
      kind={'regular'}
      size={'small'}
    />
    <!-- TODO this object selector sometimes shows wrong value -->
    <ObjectBox
      _class={products.class.ProductVersion}
      value={parent?._id}
      docQuery={{ space }}
      readonly={true}
      kind={'regular'}
      size={'small'}
      label={products.string.NoProductVersionParent}
      icon={products.icon.ProductVersion}
      showNavigate={false}
      showTooltip={{ label: products.string.ProductVersionParent }}
    />
  </svelte:fragment>

  <div class="flex-row-center flex-gap-3">
    <div class="heading-medium-20">
      {formatProductVersion(object)}
    </div>
    <EditBox placeholder={products.string.Codename} bind:value={object.codename} kind="large-style" focusIndex={3} />
  </div>

  <div class="flex-row-center flex-gap-3 clear-mins">
    <div class="flex-grow flex-col">
      <StyledTextBox
        bind:content={object.description}
        placeholder={products.string.ProductVersionDescriptionPlaceholder}
        kind={'normal'}
        focusIndex={10}
        showButtons={false}
        alwaysEdit
      />
    </div>
  </div>

  <svelte:fragment slot="pool">
    {#if parent}
      <DropdownLabelsIntl
        label={products.string.ChangeSeverity}
        items={[
          { id: 'patch', label: products.string.Patch },
          { id: 'minor', label: products.string.Minor },
          { id: 'major', label: products.string.Major }
        ]}
        bind:selected={severity}
      />
      {#if changeControl.mode === ChangeControlMode.ControlledDocument}
        <ObjectBox
          bind:value={object.changeControl}
          _class={documents.class.Document}
          docQuery={{
            space,
            category: changeControl.category,
            state: DocumentState.Effective
          }}
          docProps={{
            withTitle: true,
            isRegular: true,
            disableLink: true
          }}
          searchField={'code'}
          excluded={excludedChangeControl}
          kind={'regular'}
          size={'small'}
          label={products.string.ChangeControl}
          showNavigate={false}
        />
      {:else if changeControlAssociation !== undefined}
        <ObjectBox
          bind:value={changeControlCard}
          _class={getRelationCandidatesClass(changeControlAssociation.association, changeControlAssociation.direction)}
          docQuery={changeControlCardQuery}
          docProps={{ shouldShowAvatar: true }}
          kind={'regular'}
          size={'small'}
          label={products.string.ChangeControl}
          showNavigate={false}
        />
      {:else}
        <span class="error-color text-sm">
          <Label label={products.string.ChangeControlNotConfigured} />
        </span>
      {/if}
    {/if}
  </svelte:fragment>
</Card>
