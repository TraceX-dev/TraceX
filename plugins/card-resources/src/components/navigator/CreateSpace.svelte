<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { SpaceSettingsForm } from '@hcengineering/contact-resources'
  import core, { AccountRole, AccountUuid, Data, Ref, RolesAssignment, getCurrentAccount } from '@hcengineering/core'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import { EditBox, FormRow } from '@hcengineering/ui'
  import { permissions } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import { CardSpace, MasterTag, Role } from '@hcengineering/card'
  import card from '../../plugin'
  import TypesSelector from './TypesSelector.svelte'
  import { deepEqual } from 'fast-equals'

  export let space: CardSpace | undefined = undefined

  const dispatch = createEventDispatcher()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  const topLevelTypes = client.getModel().findAllSync(card.class.MasterTag, {
    extends: card.class.Card,
    removed: { $ne: true }
  })

  let types: Ref<MasterTag>[] =
    space?.types !== undefined ? hierarchy.clone(space.types) : topLevelTypes.map((it) => it._id)

  let roles = client.getModel().findAllSync(card.class.Role, { types: { $in: types } })
  $: roles = client.getModel().findAllSync(card.class.Role, { types: { $in: types } })

  let name: string = space?.name ?? ''

  let isPrivate: boolean = space?.private ?? false
  let restricted: boolean = space?.restricted ?? false
  let members: AccountUuid[] =
    space?.members !== undefined ? hierarchy.clone(space.members) : [getCurrentAccount().uuid]
  let owners: AccountUuid[] = space?.owners !== undefined ? hierarchy.clone(space.owners) : [getCurrentAccount().uuid]

  $: isNew = space === undefined
  // An existing space may be opened by a user who is not allowed to change it,
  // in that case the dialog is shown in a read only mode.
  $: readonly = !isNew && !$permissions.canEditSpace(space)

  let rolesAssignment = getRolesAssignment(roles)
  $: rolesAssignment = getRolesAssignment(roles)

  function getRolesAssignment (roles: Role[]): RolesAssignment {
    if (space === undefined || roles === undefined) {
      return {}
    }

    const asMixin = hierarchy.as(space, core.mixin.SpacesTypeData)

    const res = roles.reduce<RolesAssignment>((prev, { _id }) => {
      prev[_id] = (asMixin as any)[_id] ?? []

      return prev
    }, {})
    return res
  }

  function getCurrentRolesAssignment (): RolesAssignment {
    if (space === undefined) {
      return {}
    }

    const asMixin = hierarchy.as(space, core.mixin.SpacesTypeData)
    const allRoles = client.getModel().findAllSync(card.class.Role, {})

    const res: RolesAssignment = {}

    for (const role of allRoles) {
      const curr = (asMixin as any)[role._id]
      if (curr !== undefined) {
        res[role._id] = curr
      }
    }

    return res
  }

  async function handleSave (): Promise<void> {
    if (isNew) {
      await create()
    } else {
      await update()
    }
  }

  function normalizeAutoJoinForRoles (roles: AccountRole[]): AccountRole[] | undefined {
    return roles.length > 0 ? [...roles] : undefined
  }

  let autoJoinForRoles: AccountRole[] = space?.autoJoinForRoles != null ? hierarchy.clone(space.autoJoinForRoles) : []

  function getData (): Data<CardSpace> {
    return {
      name,
      description: '',
      private: isPrivate,
      members,
      owners,
      autoJoin,
      autoJoinForRoles: normalizeAutoJoinForRoles(autoJoinForRoles),
      archived: false,
      type: card.spaceType.SpaceType,
      types,
      restricted
    }
  }

  async function update (): Promise<void> {
    if (space === undefined) {
      return
    }

    const data = getData()
    await client.diffUpdate(space, data)

    if (rolesAssignment && !deepEqual(rolesAssignment, getCurrentRolesAssignment())) {
      await client.updateMixin(space._id, space._class, core.space.Space, core.mixin.SpacesTypeData, rolesAssignment)
    }

    close()
  }

  async function create (): Promise<void> {
    const data = getData()

    const id = await client.createDoc(card.class.CardSpace, core.space.Space, data)

    if (rolesAssignment && !deepEqual(rolesAssignment, getCurrentRolesAssignment())) {
      await client.updateMixin(id, card.class.CardSpace, core.space.Space, core.mixin.SpacesTypeData, rolesAssignment)
    }

    close(id)
  }

  function close (id?: Ref<CardSpace>): void {
    dispatch('close', id)
  }

  let autoJoin = space?.autoJoin ?? false

  $: canSave =
    !readonly &&
    name.trim().length > 0 &&
    !(members.length === 0 && isPrivate) &&
    owners.length > 0 &&
    (!isPrivate || owners.some((o) => members.includes(o)))
</script>

<Card
  label={core.string.Space}
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
    bind:autoJoinForRoles
    bind:restricted
    bind:rolesAssignment
    {roles}
    {readonly}
    privateToggleId={'teamspace-private'}
    autoJoinToggleId={'space-autoJoin'}
    restrictedToggleId={'space-restricted'}
  >
    <FormRow label={core.string.Name}>
      <EditBox
        id="teamspace-title"
        bind:value={name}
        placeholder={core.string.Name}
        disabled={readonly}
        kind={'medium-style'}
        fullSize
        autoFocus
      />
    </FormRow>

    <FormRow label={card.string.MasterTags}>
      <TypesSelector bind:value={types} {readonly} />
    </FormRow>
  </SpaceSettingsForm>
</Card>
