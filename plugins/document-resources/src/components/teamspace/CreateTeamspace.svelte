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
  import { SpaceSettingsForm } from '@hcengineering/contact-resources'
  import core, {
    Data,
    DocumentUpdate,
    RolesAssignment,
    Ref,
    Role,
    SpaceType,
    generateId,
    getCurrentAccount,
    WithLookup,
    AccountUuid
  } from '@hcengineering/core'
  import document, { Teamspace, DocumentEvents } from '@hcengineering/document'
  import { Asset } from '@hcengineering/platform'
  import presentation, { IconWithEmoji, Card, getClient, reduceCalls } from '@hcengineering/presentation'
  import {
    Button,
    EditBox,
    SettingsInputField,
    SettingsRow,
    getColorNumberByText,
    getPlatformColorDef,
    getPlatformColorForTextDef,
    showPopup,
    themeStore
  } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { IconPicker, SpaceTypeSelector } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'
  import { Analytics } from '@hcengineering/analytics'

  import documentRes from '../../plugin'

  export let teamspace: Teamspace | undefined = undefined
  export let namePlaceholder: string = ''
  export let descriptionPlaceholder: string = ''

  const dispatch = createEventDispatcher()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  let name: string = teamspace?.name ?? namePlaceholder
  let description: string = teamspace?.description ?? descriptionPlaceholder
  let isPrivate: boolean = teamspace?.private ?? false
  let icon: Asset | undefined = teamspace?.icon ?? undefined
  let color = teamspace?.color ?? getColorNumberByText(name)
  let isColorSelected = false
  let members: AccountUuid[] =
    teamspace?.members !== undefined ? hierarchy.clone(teamspace.members) : [getCurrentAccount().uuid]
  let owners: AccountUuid[] =
    teamspace?.owners !== undefined ? hierarchy.clone(teamspace.owners) : [getCurrentAccount().uuid]
  let rolesAssignment: RolesAssignment = {}

  $: isNew = teamspace === undefined

  let typeId: Ref<SpaceType> | undefined = teamspace?.type ?? document.spaceType.DefaultTeamspaceType
  let spaceType: WithLookup<SpaceType> | undefined

  $: void loadSpaceType(typeId)
  const loadSpaceType = reduceCalls(async (id: typeof typeId): Promise<void> => {
    spaceType =
      id !== undefined
        ? await client
            .getModel()
            .findOne(core.class.SpaceType, { _id: id }, { lookup: { _id: { roles: core.class.Role } } })
        : undefined

    if (teamspace === undefined || spaceType?.targetClass === undefined || spaceType?.$lookup?.roles === undefined) {
      return
    }

    rolesAssignment = getRolesAssignment()
  })

  function getRolesAssignment (): RolesAssignment {
    if (teamspace === undefined || spaceType?.targetClass === undefined || spaceType?.$lookup?.roles === undefined) {
      return {}
    }

    const asMixin = hierarchy.as(teamspace, spaceType?.targetClass)

    return spaceType.$lookup.roles.reduce<RolesAssignment>((prev, { _id }) => {
      prev[_id as Ref<Role>] = (asMixin as any)[_id] ?? []

      return prev
    }, {})
  }

  async function handleSave (): Promise<void> {
    if (isNew) {
      await createTeamspace()
    } else {
      await updateTeamspace()
    }
  }

  function getTeamspaceData (): Omit<Data<Teamspace>, 'type'> {
    return {
      name,
      description,
      private: isPrivate,
      members,
      owners,
      autoJoin,
      archived: false,
      icon,
      color
    }
  }

  async function updateTeamspace (): Promise<void> {
    if (teamspace === undefined || spaceType?.targetClass === undefined) {
      return
    }

    const teamspaceData = getTeamspaceData()
    const update: DocumentUpdate<Teamspace> = {}
    if (teamspaceData.name !== teamspace?.name) {
      update.name = teamspaceData.name
    }
    if (teamspaceData.description !== teamspace?.description) {
      update.description = teamspaceData.description
    }
    if (teamspaceData.private !== teamspace?.private) {
      update.private = teamspaceData.private
    }
    if (teamspaceData.icon !== teamspace?.icon) {
      update.icon = teamspaceData.icon
    }
    if (teamspaceData.color !== teamspace?.color) {
      update.color = teamspaceData.color
    }
    if (teamspaceData.autoJoin !== teamspace?.autoJoin) {
      update.autoJoin = teamspaceData.autoJoin
    }
    if (teamspaceData.members.length !== teamspace?.members.length) {
      update.members = teamspaceData.members
    } else {
      for (const member of teamspaceData.members) {
        if (teamspace.members.findIndex((p) => p === member) === -1) {
          update.members = teamspaceData.members
          break
        }
      }
    }
    if (teamspaceData.owners?.length !== teamspace?.owners?.length) {
      update.owners = teamspaceData.owners
    } else {
      for (const owner of teamspaceData.owners ?? []) {
        if (teamspace.owners?.findIndex((p) => p === owner) === -1) {
          update.owners = teamspaceData.owners
          break
        }
      }
    }

    if (Object.keys(update).length > 0) {
      await client.update(teamspace, update)
    }

    if (!deepEqual(rolesAssignment, getRolesAssignment())) {
      await client.updateMixin(
        teamspace._id,
        document.class.Teamspace,
        core.space.Space,
        spaceType.targetClass,
        rolesAssignment
      )
    }

    close()
  }

  async function createTeamspace (): Promise<void> {
    if (typeId === undefined || spaceType?.targetClass === undefined) {
      return
    }

    const teamspaceId = generateId<Teamspace>()
    const teamspaceData = getTeamspaceData()

    await client.createDoc(document.class.Teamspace, core.space.Space, { ...teamspaceData, type: typeId }, teamspaceId)

    // Create space type's mixin with roles assignments
    await client.createMixin(
      teamspaceId,
      document.class.Teamspace,
      core.space.Space,
      spaceType.targetClass,
      rolesAssignment
    )

    Analytics.handleEvent(DocumentEvents.TeamspaceCreated, { id: teamspaceId })
    close(teamspaceId)
  }

  function chooseIcon (ev: MouseEvent): void {
    const icons = [document.icon.Document, document.icon.Teamspace]
    const update = (result: any): void => {
      if (result !== undefined && result !== null) {
        icon = result.icon
        color = result.color
        isColorSelected = true
      }
    }
    showPopup(IconPicker, { icon, color, icons }, 'top', update, update)
  }

  function close (id?: Ref<Teamspace>): void {
    dispatch('close', id)
  }

  function handleTypeChange (evt: CustomEvent<Ref<SpaceType>>): void {
    typeId = evt.detail
  }

  $: roles = (spaceType?.$lookup?.roles ?? []) as Role[]

  let autoJoin = teamspace?.autoJoin ?? spaceType?.autoJoin ?? false

  $: setDefaultMembers(spaceType)

  let membersChanged: boolean = false

  function setDefaultMembers (typeType: SpaceType | undefined): void {
    if (typeType === undefined) return
    if (membersChanged) return
    if (teamspace !== undefined) return
    autoJoin = typeType.autoJoin ?? false
    if (typeType.members === undefined || typeType.members.length === 0) return
    members = typeType.members
  }

  $: canSave =
    name.trim().length > 0 &&
    !(members.length === 0 && isPrivate) &&
    typeId !== undefined &&
    spaceType?.targetClass !== undefined &&
    owners.length > 0 &&
    (!isPrivate || owners.some((o) => members.includes(o)))
</script>

<Card
  label={isNew ? documentRes.string.NewTeamspace : documentRes.string.EditTeamspace}
  okLabel={isNew ? presentation.string.Create : presentation.string.Save}
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
    bind:rolesAssignment
    {roles}
    membersLabel={documentRes.string.TeamspaceMembers}
    privateToggleId={'teamspace-private'}
    autoJoinToggleId={'teamspace-autoJoin'}
    on:membersChange={() => {
      membersChanged = true
    }}
  >
    <SettingsRow label={core.string.SpaceType}>
      <SpaceTypeSelector
        disabled={!isNew}
        descriptors={[document.descriptor.TeamspaceType]}
        type={typeId}
        focusIndex={4}
        kind="regular"
        size="large"
        on:change={handleTypeChange}
      />
    </SettingsRow>

    <SettingsRow label={documentRes.string.TeamspaceTitle}>
      <EditBox
        id="teamspace-title"
        bind:value={name}
        placeholder={documentRes.string.TeamspaceTitlePlaceholder}
        kind={'medium-style'}
        fullSize
        autoFocus
        on:input={() => {
          if (isNew) {
            color = isColorSelected ? color : getColorNumberByText(name)
          }
        }}
      />
    </SettingsRow>

    <SettingsRow label={documentRes.string.Description}>
      <SettingsInputField multiline>
        <EditBox
          id="teamspace-description"
          bind:value={description}
          placeholder={documentRes.string.TeamspaceDescriptionPlaceholder}
        />
      </SettingsInputField>
    </SettingsRow>

    <SettingsRow label={documentRes.string.ChooseIcon}>
      <Button
        icon={icon === view.ids.IconWithEmoji ? IconWithEmoji : (icon ?? document.icon.Teamspace)}
        iconProps={icon === view.ids.IconWithEmoji
          ? { icon: color }
          : {
              fill:
                color !== undefined && typeof color !== 'string'
                  ? getPlatformColorDef(color, $themeStore.dark).icon
                  : getPlatformColorForTextDef(name, $themeStore.dark).icon
            }}
        size={'large'}
        on:click={chooseIcon}
      />
    </SettingsRow>
  </SpaceSettingsForm>
</Card>
