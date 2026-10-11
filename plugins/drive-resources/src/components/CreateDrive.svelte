<!--
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
-->
<script lang="ts">
  import { deepEqual } from 'fast-equals'
  import { createEventDispatcher } from 'svelte'
  import { SpaceSettingsForm } from '@hcengineering/contact-resources'
  import core, {
    Data,
    RolesAssignment,
    Ref,
    Role,
    SpaceType,
    generateId,
    getCurrentAccount,
    WithLookup,
    AccountUuid
  } from '@hcengineering/core'
  import { Drive, DriveEvents } from '@hcengineering/drive'
  import presentation, { Card, getClient, reduceCalls } from '@hcengineering/presentation'
  import { EditBox, FormInputField, FormRow } from '@hcengineering/ui'
  import { SpaceTypeSelector } from '@hcengineering/view-resources'

  import driveRes from '../plugin'
  import { Analytics } from '@hcengineering/analytics'

  export let drive: Drive | undefined = undefined

  const dispatch = createEventDispatcher()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  let name: string = drive?.name ?? ''
  let description: string = drive?.description ?? ''
  let isPrivate: boolean = drive?.private ?? false

  let autoJoin = drive?.autoJoin ?? false
  let restricted: boolean = drive?.restricted ?? false
  let members: AccountUuid[] =
    drive?.members !== undefined ? hierarchy.clone(drive.members) : [getCurrentAccount().uuid]
  let owners: AccountUuid[] = drive?.owners !== undefined ? hierarchy.clone(drive.owners) : [getCurrentAccount().uuid]
  let rolesAssignment: RolesAssignment = {}

  let typeId: Ref<SpaceType> | undefined = drive?.type ?? driveRes.spaceType.DefaultDrive
  let spaceType: WithLookup<SpaceType> | undefined

  $: void loadSpaceType(typeId)
  const loadSpaceType = reduceCalls(async (id: typeof typeId): Promise<void> => {
    spaceType =
      id !== undefined
        ? await client
            .getModel()
            .findOne(core.class.SpaceType, { _id: id }, { lookup: { _id: { roles: core.class.Role } } })
        : undefined

    if (drive === undefined || spaceType?.targetClass === undefined || spaceType?.$lookup?.roles === undefined) {
      return
    }

    rolesAssignment = getRolesAssignment()
  })

  function getRolesAssignment (): RolesAssignment {
    if (drive === undefined || spaceType?.targetClass === undefined || spaceType?.$lookup?.roles === undefined) {
      return {}
    }

    const asMixin = hierarchy.as(drive, spaceType?.targetClass)

    return spaceType.$lookup.roles.reduce<RolesAssignment>((prev, { _id }) => {
      prev[_id as Ref<Role>] = (asMixin as any)[_id] ?? []

      return prev
    }, {})
  }

  async function handleSave (): Promise<void> {
    if (drive === undefined) {
      await createDrive()
    } else {
      await updateDrive()
    }
  }

  function getDriveData (): Omit<Data<Drive>, 'type'> {
    return {
      name,
      description,
      private: isPrivate,
      members,
      owners,
      autoJoin,
      archived: false,
      restricted
    }
  }

  async function updateDrive (): Promise<void> {
    if (drive === undefined || spaceType?.targetClass === undefined) {
      return
    }

    const update = getDriveData()
    await client.diffUpdate(drive, update)

    if (!deepEqual(rolesAssignment, getRolesAssignment())) {
      await client.updateMixin(
        drive._id,
        driveRes.class.Drive,
        core.space.Space,
        spaceType.targetClass,
        rolesAssignment
      )
    }

    close()
  }

  async function createDrive (): Promise<void> {
    if (typeId === undefined || spaceType?.targetClass === undefined) {
      return
    }

    const driveId = generateId<Drive>()
    const driveData = getDriveData()

    await client.createDoc(driveRes.class.Drive, core.space.Space, { ...driveData, type: typeId }, driveId)

    // Create space type's mixin with roles assignments
    await client.createMixin(driveId, driveRes.class.Drive, core.space.Space, spaceType.targetClass, rolesAssignment)
    Analytics.handleEvent(DriveEvents.DriveCreated, { id: driveId })
    close(driveId)
  }

  function close (id?: Ref<Drive>): void {
    dispatch('close', id)
  }

  function handleTypeChange (evt: CustomEvent<Ref<SpaceType>>): void {
    typeId = evt.detail
  }

  $: roles = (spaceType?.$lookup?.roles ?? []) as Role[]

  $: canSave =
    name.trim().length > 0 &&
    !(members.length === 0 && isPrivate) &&
    typeId !== undefined &&
    spaceType?.targetClass !== undefined &&
    owners.length > 0 &&
    (!isPrivate || owners.some((o) => members.includes(o)))
</script>

<Card
  label={drive ? driveRes.string.EditDrive : driveRes.string.CreateDrive}
  okLabel={drive ? presentation.string.Save : presentation.string.Create}
  okAction={handleSave}
  {canSave}
  accentHeader
  width={'medium'}
  gap={'gapV-6'}
  onCancel={close}
  on:changeContent
>
  <SpaceSettingsForm
    bind:owners
    bind:members
    bind:isPrivate
    bind:autoJoin
    bind:restricted
    bind:rolesAssignment
    {roles}
    autoJoinToggleId={'space-autoJoin'}
    restrictedToggleId={'space-restricted'}
  >
    <FormRow label={core.string.SpaceType}>
      <SpaceTypeSelector
        disabled={drive !== undefined}
        descriptors={[driveRes.descriptor.DriveType]}
        type={typeId}
        focusIndex={4}
        kind="regular"
        size="large"
        on:change={handleTypeChange}
      />
    </FormRow>

    <FormRow label={core.string.Name}>
      <EditBox
        id="teamspace-title"
        bind:value={name}
        placeholder={core.string.Name}
        kind={'medium-style'}
        fullSize
        autoFocus
      />
    </FormRow>

    <FormRow label={core.string.Description}>
      <FormInputField multiline>
        <EditBox id="teamspace-description" bind:value={description} placeholder={core.string.Description} />
      </FormInputField>
    </FormRow>
  </SpaceSettingsForm>
</Card>
