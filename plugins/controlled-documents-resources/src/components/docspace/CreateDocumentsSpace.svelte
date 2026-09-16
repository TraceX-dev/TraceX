<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import { deepEqual } from 'fast-equals'
  import { createEventDispatcher } from 'svelte'
  import { SpaceSettingsForm } from '@hcengineering/contact-resources'
  import core, {
    Data,
    DocumentUpdate,
    RolesAssignment,
    Ref,
    Role,
    generateId,
    getCurrentAccount,
    WithLookup,
    Class,
    AccountUuid
  } from '@hcengineering/core'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import { StyledTextBox } from '@hcengineering/text-editor-resources'
  import { EditBox, FormInputField, FormRow } from '@hcengineering/ui'
  import { SpaceTypeSelector } from '@hcengineering/view-resources'
  import documents, { DocumentSpace, DocumentSpaceType } from '@hcengineering/controlled-documents'

  import documentsRes from '../../plugin'

  export let docSpace: DocumentSpace | undefined = undefined
  export let clazz: Ref<Class<DocumentSpace>> = documents.class.OrgSpace
  export let namePlaceholder: string = ''
  export let descriptionPlaceholder: string = ''

  const dispatch = createEventDispatcher()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  let name: string = docSpace?.name ?? namePlaceholder
  let description: string = docSpace?.description ?? descriptionPlaceholder
  let isPrivate: boolean = docSpace?.private ?? true
  let members: AccountUuid[] =
    docSpace?.members !== undefined ? hierarchy.clone(docSpace.members) : [getCurrentAccount().uuid]
  let owners: AccountUuid[] =
    docSpace?.owners !== undefined ? hierarchy.clone(docSpace.owners) : [getCurrentAccount().uuid]
  let rolesAssignment: RolesAssignment = {}

  $: isNew = docSpace === undefined

  let typeId: Ref<DocumentSpaceType> | undefined = docSpace?.type ?? documents.spaceType.DocumentSpaceType
  let spaceType: WithLookup<DocumentSpaceType> | undefined

  $: void loadSpaceType(typeId)
  async function loadSpaceType (id: typeof typeId): Promise<void> {
    spaceType =
      id !== undefined
        ? await client
            .getModel()
            .findOne(documents.class.DocumentSpaceType, { _id: id }, { lookup: { _id: { roles: core.class.Role } } })
        : undefined

    if (docSpace === undefined || spaceType?.targetClass === undefined || spaceType?.$lookup?.roles === undefined) {
      return
    }

    rolesAssignment = getRolesAssignment()
  }
  $: descriptors =
    spaceType?.descriptor !== undefined ? [spaceType.descriptor] : [documents.descriptor.DocumentSpaceType]

  function getRolesAssignment (): RolesAssignment {
    if (docSpace === undefined || spaceType?.targetClass === undefined || spaceType?.$lookup?.roles === undefined) {
      return {}
    }

    const asMixin = hierarchy.as(docSpace, spaceType?.targetClass)

    return spaceType.$lookup.roles.reduce<RolesAssignment>((prev, { _id }) => {
      prev[_id as Ref<Role>] = (asMixin as any)[_id]

      return prev
    }, {})
  }

  async function handleSave (): Promise<void> {
    if (isNew) {
      await createDocumentSpace()
    } else {
      await updateDocumentSpace()
    }
  }

  function getDocSpaceData (): Omit<Data<DocumentSpace>, 'type'> {
    return {
      name,
      description,
      private: isPrivate,
      members,
      owners,
      archived: false
    }
  }

  async function updateDocumentSpace (): Promise<void> {
    if (docSpace === undefined || spaceType?.targetClass === undefined) {
      return
    }

    const docSpaceData = getDocSpaceData()
    const update: DocumentUpdate<DocumentSpace> = {}
    if (docSpaceData.name !== docSpace?.name) {
      update.name = docSpaceData.name
    }
    if (docSpaceData.description !== docSpace?.description) {
      update.description = docSpaceData.description
    }
    if (docSpaceData.private !== docSpace?.private) {
      update.private = docSpaceData.private
    }
    if (docSpaceData.members.length !== docSpace?.members.length) {
      update.members = docSpaceData.members
    } else {
      for (const member of docSpaceData.members) {
        if (docSpace.members.findIndex((p) => p === member) === -1) {
          update.members = docSpaceData.members
          break
        }
      }
    }
    if (docSpaceData.owners?.length !== docSpace?.owners?.length) {
      update.owners = docSpaceData.owners
    } else {
      for (const owner of docSpaceData.owners ?? []) {
        if (docSpace.owners?.findIndex((p) => p === owner) === -1) {
          update.owners = docSpaceData.owners
          break
        }
      }
    }

    if (Object.keys(update).length > 0) {
      await client.update(docSpace, update)
    }

    if (!deepEqual(rolesAssignment, getRolesAssignment())) {
      await client.updateMixin(docSpace._id, clazz, core.space.Space, spaceType.targetClass, rolesAssignment)
    }

    close()
  }

  async function createDocumentSpace (): Promise<void> {
    if (typeId === undefined || spaceType?.targetClass === undefined) {
      return
    }

    const docSpaceId = generateId<DocumentSpace>()
    const docSpaceData = getDocSpaceData()

    await client.createDoc(clazz, core.space.Space, { ...docSpaceData, type: typeId }, docSpaceId)

    // Create space type's mixin with roles assignments
    await client.createMixin(docSpaceId, clazz, core.space.Space, spaceType.targetClass, rolesAssignment)

    close(docSpaceId)
  }

  function close (id?: Ref<DocumentSpace>): void {
    dispatch('close', id)
  }

  function handleTypeChange (evt: CustomEvent<Ref<DocumentSpaceType>>): void {
    typeId = evt.detail
  }

  $: roles = (spaceType?.$lookup?.roles ?? []) as Role[]

  $: canSave =
    name.length > 0 &&
    members.length > 0 &&
    typeId !== undefined &&
    spaceType?.targetClass !== undefined &&
    owners.length > 0 &&
    (!isPrivate || owners.some((o) => members.includes(o)))
</script>

<Card
  label={isNew ? documentsRes.string.NewDocumentSpace : documentsRes.string.EditDocumentSpace}
  okLabel={isNew ? presentation.string.Create : presentation.string.Save}
  okAction={handleSave}
  {canSave}
  accentHeader
  width="medium"
  gap="gapV-6"
  onCancel={close}
  on:changeContent
>
  <SpaceSettingsForm
    bind:owners
    bind:members
    bind:isPrivate
    bind:rolesAssignment
    {roles}
    privateDisabled={isNew || docSpace?.private === true}
    membersLabel={documentsRes.string.Members}
  >
    <FormRow label={core.string.SpaceType}>
      <SpaceTypeSelector
        disabled={!isNew}
        {descriptors}
        type={typeId}
        focusIndex={4}
        kind="regular"
        size="large"
        on:change={handleTypeChange}
      />
    </FormRow>

    <FormRow label={documentsRes.string.Title}>
      <EditBox
        bind:value={name}
        placeholder={documentsRes.string.NewDocumentSpace}
        kind="medium-style"
        fullSize
        autoFocus
      />
    </FormRow>

    <FormRow label={documentsRes.string.Description} align="top">
      <FormInputField multiline>
        <StyledTextBox
          alwaysEdit
          showButtons={false}
          bind:content={description}
          placeholder={documentsRes.string.DocSpaceDescriptionPlaceholder}
        />
      </FormInputField>
    </FormRow>
  </SpaceSettingsForm>
</Card>
