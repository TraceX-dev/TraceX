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

  import documents, { copyProjectDocuments, deleteProjectDrafts } from '@hcengineering/controlled-documents'
  import { Product, ProductVersion, ProductVersionState } from '@hcengineering/products'
  import { Data, Doc, DocumentQuery, Ref, SortingOrder, generateId } from '@hcengineering/core'
  import { Card, MessageBox, SpaceSelector, createQuery, getClient } from '@hcengineering/presentation'
  import { StyledTextBox } from '@hcengineering/text-editor-resources'
  import { DropdownLabelsIntl, EditBox, FocusHandler, createFocusManager, showPopup } from '@hcengineering/ui'
  import {
    ObjectBox,
    RelationsCreateEditor,
    buildRefAttributeQuery,
    commitPendingRelations,
    getRefAttributeClass,
    type PendingRelation
  } from '@hcengineering/view-resources'

  import products from '../../plugin'

  type Severity = 'major' | 'minor' | 'patch'
  type ProductVersionDraft = Omit<Data<ProductVersion>, 'parent' | 'name'>

  export let space: Ref<Product> | undefined

  const dispatch = createEventDispatcher()
  const client = getClient()
  const query = createQuery()
  const manager = createFocusManager()
  const hierarchy = client.getHierarchy()

  // Change control is a reference configured in the ProductVersion class settings
  const changeControlAttribute = hierarchy.findAttribute(products.class.ProductVersion, 'changeControl')
  const changeControlClass =
    changeControlAttribute !== undefined && changeControlAttribute.hidden !== true
      ? getRefAttributeClass(hierarchy, changeControlAttribute)
      : undefined
  const isDocumentChangeControl =
    changeControlClass !== undefined && hierarchy.isDerived(changeControlClass, documents.class.Document)
  const changeControlSearchField = isDocumentChangeControl
    ? 'code'
    : changeControlClass !== undefined && hierarchy.findAttribute(changeControlClass, 'title') !== undefined
      ? 'title'
      : 'name'

  const id: Ref<ProductVersion> = generateId()

  let object: Omit<Data<ProductVersion>, 'parent' | 'name'> = createDefaultObject()
  let excludedChangeControl: Array<Ref<Doc>> = []
  let changeControlQuery: DocumentQuery<Doc> | undefined
  let changeControlQueryRequest = 0
  let previousSpace = space

  let parent: ProductVersion | null | undefined
  let severity: Severity = 'minor'

  let pendingRelations: PendingRelation[] = []

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

  $: if (space !== previousSpace) {
    previousSpace = space
    object.changeControl = undefined
  }

  $: void updateChangeControlQuery(space)

  async function updateChangeControlQuery (space: Ref<Product> | undefined): Promise<void> {
    const request = ++changeControlQueryRequest
    changeControlQuery = undefined
    if (changeControlAttribute === undefined || changeControlClass === undefined) return
    try {
      const query = await buildRefAttributeQuery(changeControlAttribute, { space })
      if (request === changeControlQueryRequest) {
        changeControlQuery = query
      }
    } catch (err) {
      console.error('Failed to build change control query', err)
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
    if (space === undefined) {
      return
    }

    const ops = client.apply()

    const version = {
      ...object,
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

    await commitPendingRelations(ops, id, pendingRelations)

    await ops.commit()

    object = createDefaultObject()
    pendingRelations = []
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

  // Change control is required for every version except the first one, when it is configured
  function hasChangeControl (changeControl: Ref<Doc> | undefined): boolean {
    return changeControlClass === undefined || changeControl !== undefined
  }

  $: canSave =
    space !== undefined &&
    parent !== undefined &&
    object.major !== undefined &&
    object.major >= 0 &&
    object.minor !== undefined &&
    object.minor >= 0 &&
    object.patch !== undefined &&
    object.patch >= 0 &&
    (parent == null || hasChangeControl(object.changeControl))
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
      {#if changeControlClass !== undefined && changeControlQuery !== undefined}
        <ObjectBox
          bind:value={object.changeControl}
          _class={changeControlClass}
          docQuery={changeControlQuery}
          docProps={isDocumentChangeControl
            ? { withTitle: true, isRegular: true, disableLink: true }
            : { shouldShowAvatar: true }}
          searchField={changeControlSearchField}
          excluded={excludedChangeControl}
          kind={'regular'}
          size={'small'}
          label={changeControlAttribute?.label ?? products.string.ChangeControl}
          showNavigate={false}
        />
      {/if}
    {/if}
    <RelationsCreateEditor _class={products.class.ProductVersion} bind:selection={pendingRelations} />
  </svelte:fragment>
</Card>
