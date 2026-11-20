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
  import core, { getCurrentAccount, Ref, notEmpty, AccountUuid, type UserGroup } from '@hcengineering/core'
  import presentation, { createQuery } from '@hcengineering/presentation'
  import { Label, showPopup, tooltip } from '@hcengineering/ui'

  import { Channel, ChunterSpace, ObjectChatPanel } from '@hcengineering/chunter'
  import { Employee, Person } from '@hcengineering/contact'
  import {
    EmployeeBox,
    employeeRefByAccountUuidStore,
    SelectUsersPopup,
    employeeByIdStore,
    getPersonRefByPersonIdCb
  } from '@hcengineering/contact-resources'

  import { permissions } from '@hcengineering/view-resources'

  import ChannelMembers from '../ChannelMembers.svelte'
  import DocAside from './DocAside.svelte'
  import { joinChannel, leaveChannel } from '../../utils'

  export let object: ChunterSpace
  export let objectChatPanel: ObjectChatPanel | undefined

  const socialStrings = getCurrentAccount().socialIds

  let members = new Set<Ref<Person>>()

  let creatorPersonRef: Ref<Person>
  $: if (object.createdBy !== undefined) {
    getPersonRefByPersonIdCb(object.createdBy, (personRef) => {
      if (personRef == null) return
      creatorPersonRef = personRef
    })
  }

  // Members given only by bound user groups can not be removed here: removing them would change nothing.
  // Guests can not read groups, the list stays empty for them.
  let boundGroups: UserGroup[] = []
  const groupsQuery = createQuery()
  $: if ((object.groups ?? []).length > 0) {
    groupsQuery.query(core.class.UserGroup, { _id: { $in: object.groups ?? [] } }, (groups) => {
      boundGroups = groups
    })
  } else {
    groupsQuery.unsubscribe()
    boundGroups = []
  }

  // Recomputed on any change of the channel, its groups or the employees: the space and the groups arrive in
  // separate updates, a list built only when the groups change goes stale.
  $: directAccounts = object.directMembers ?? object.members
  $: groupOnlyPersons = getGroupOnlyPersons(object.members, directAccounts, boundGroups, $employeeRefByAccountUuidStore)
  $: directPersons = new Set<Ref<Person>>(
    directAccounts.map((account) => $employeeRefByAccountUuidStore.get(account)).filter(notEmpty)
  )

  function getGroupOnlyPersons (
    members: AccountUuid[],
    direct: AccountUuid[],
    groups: UserGroup[],
    refs: Map<AccountUuid, Ref<Employee>>
  ): Array<Ref<Person>> {
    if (groups.length === 0) return []
    const byGroups = new Set(groups.flatMap((group) => group.members))
    return members
      .filter((account) => byGroups.has(account) && !direct.includes(account))
      .map((account) => refs.get(account))
      .filter(notEmpty)
  }

  $: creatorRemoveDisabled =
    object.createdBy !== undefined && !socialStrings.includes(object.createdBy) && creatorPersonRef !== undefined
      ? [creatorPersonRef]
      : []
  $: disabledRemoveFor = [...creatorRemoveDisabled, ...groupOnlyPersons]
  $: updateMembers(object)

  function updateMembers (object: Channel | undefined): void {
    if (object === undefined) {
      members = new Set()
      return
    }

    members = new Set(object.members.map((account) => $employeeRefByAccountUuidStore.get(account)).filter(notEmpty))
  }

  function getAccountsByPersons (persons: Ref<Person>[]): AccountUuid[] {
    return persons.map((person) => $employeeByIdStore.get(person as Ref<Employee>)?.personUuid).filter(notEmpty)
  }

  async function changeMembers (personRefs: Ref<Person>[], object?: Channel): Promise<void> {
    if (object === undefined) {
      return
    }

    // The popup edits direct members: a member through a group that gets checked becomes a direct one, and one that
    // stays unchecked is not pulled (it would change nothing).
    const personsToLeave = canRemoveMembers ? Array.from(directPersons).filter((_id) => !personRefs.includes(_id)) : []
    const accountsToLeave = getAccountsByPersons(personsToLeave)
    const personsToJoin = canAddMembers ? personRefs.filter((_id) => !directPersons.has(_id)) : []
    const accountsToJoin = getAccountsByPersons(personsToJoin)

    await Promise.all([leaveChannel(object, accountsToLeave), joinChannel(object, accountsToJoin)])
  }

  async function removeMember (ev: CustomEvent): Promise<void> {
    if (object === undefined || !canRemoveMembers) {
      return
    }

    const personId = ev.detail as Ref<Person> | undefined

    if (personId === undefined) {
      return
    }

    const accountsToLeave = getAccountsByPersons([personId])

    await leaveChannel(object, accountsToLeave)
  }

  function openSelectUsersPopup (): void {
    if (!canAddMembers && !canRemoveMembers) return

    showPopup(
      SelectUsersPopup,
      {
        okLabel: presentation.string.Add,
        disableDeselectFor: canRemoveMembers ? creatorRemoveDisabled : Array.from(directPersons),
        skipInactive: true,
        selected: directPersons,
        showStatus: true
      },
      'top',
      (result?: Ref<Person>[]) => {
        if (result != null) {
          void changeMembers(result, object)
        }
      }
    )
  }
  $: canAddMembers = !(object?.archived ?? false) && $permissions.canAddMembers(object)
  $: canRemoveMembers = !(object?.archived ?? false) && $permissions.canRemoveMembers(object)
</script>

<DocAside {object} {objectChatPanel}>
  {#if creatorPersonRef}
    <div class="popupPanel-body__aside-grid" style:margin-top="0">
      <span
        class="labelOnPanel"
        use:tooltip={{
          component: Label,
          props: { label: core.string.CreatedBy }
        }}
      >
        <Label label={core.string.CreatedBy} />
      </span>
      <div class="flex flex-grow min-w-0">
        <EmployeeBox
          value={creatorPersonRef}
          label={core.string.CreatedBy}
          kind={'link'}
          size={'medium'}
          avatarSize={'card'}
          width={'100%'}
          showNavigate={false}
          readonly
        />
      </div>
    </div>
  {/if}

  <div class="members">
    <ChannelMembers
      ids={Array.from(members)}
      disableRemoveFor={disabledRemoveFor}
      canAdd={canAddMembers}
      canRemove={canRemoveMembers}
      on:add={openSelectUsersPopup}
      on:remove={removeMember}
    />
  </div>
</DocAside>

<style lang="scss">
  .members {
    padding: var(--spacing-2);
  }
</style>
