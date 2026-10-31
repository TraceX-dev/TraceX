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
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import core, { type AccountUuid, type Ref, type Space, type UserGroup } from '@hcengineering/core'
  import presentation, { getClient, MessageBox } from '@hcengineering/presentation'
  import {
    Button,
    ButtonIcon,
    EditBox,
    IconAdd,
    IconDelete,
    Label,
    ListView,
    Loading,
    Scroller,
    SearchInput,
    SectionEmpty,
    SettingsCard,
    showPopup
  } from '@hcengineering/ui'

  import setting from '../../plugin'
  import CreateUserGroup from './CreateUserGroup.svelte'

  /** All spaces of the access page: used to show and warn about the spaces a group is bound to. */
  export let spaces: Space[]
  export let groups: UserGroup[]
  export let groupsLoading: boolean
  export let handleError: (error: unknown) => void

  const client = getClient()

  let search = ''

  function boundSpaces (group: Ref<UserGroup>): Space[] {
    return spaces.filter((space) => space.groups?.includes(group) === true)
  }

  function createGroup (): void {
    showPopup(CreateUserGroup, { handleError }, 'top')
  }

  async function rename (group: UserGroup, event: Event): Promise<void> {
    // A text EditBox forwards the DOM change event.
    const name = ((event.target as HTMLInputElement | null)?.value ?? '').trim()
    if (name === '' || name === group.name) return
    await client.update(group, { name }).catch(handleError)
  }

  async function updateMembers (group: UserGroup, members: AccountUuid[]): Promise<void> {
    await client.update(group, { members }).catch(handleError)
  }

  function remove (group: UserGroup): void {
    showPopup(MessageBox, {
      label: setting.string.DeleteUserGroup,
      message: setting.string.DeleteUserGroupConfirm,
      params: { name: group.name, count: boundSpaces(group._id).length },
      dangerous: true,
      action: async () => {
        await client.remove(group).catch(handleError)
      }
    })
  }

  $: visibleGroups = groups
    .filter((group) => {
      const query = search.trim().toLowerCase()
      return query === '' || group.name.toLowerCase().includes(query)
    })
    .sort((left, right) => left.name.localeCompare(right.name))
</script>

<Scroller align={'center'} padding={'var(--spacing-4)'}>
  <div class="groupsContent">
    <SettingsCard label={core.string.UserGroups}>
      <p class="caption-color mt-0 mb-4"><Label label={setting.string.UserGroupsHint} /></p>
      <div class="flex-between flex-wrap flex-gap-2 mb-4">
        <SearchInput bind:value={search} width={'22rem'} placeholder={setting.string.SearchUserGroups} />
        <Button
          icon={IconAdd}
          label={presentation.string.Create}
          kind={'primary'}
          size={'medium'}
          on:click={createGroup}
        />
      </div>
      {#if groupsLoading}
        <Loading />
      {:else if visibleGroups.length === 0}
        <SectionEmpty
          icon={setting.icon.Members}
          label={groups.length === 0 ? setting.string.NoUserGroups : presentation.string.NoResults}
        />
      {:else}
        <div class="groupsTable">
          <div class="groupRow caption-color text-sm">
            <span><Label label={core.string.Name} /></span>
            <span><Label label={core.string.Members} /></span>
            <span><Label label={setting.string.Spaces} /></span>
          </div>
          <ListView
            items={visibleGroups}
            count={visibleGroups.length}
            getKey={(index) => visibleGroups[index]._id}
            selection={-1}
            updateOnMouse={false}
            kind={'full-size'}
            noScroll
          >
            <svelte:fragment slot="item" let:item={index}>
              {@const group = visibleGroups[index]}
              {@const bound = boundSpaces(group._id)}
              <div class="groupRow" data-id={`user-group-${group.name}`}>
                <EditBox value={group.name} placeholder={core.string.Name} on:change={(event) => rename(group, event)} />
                <AccountArrayEditor
                  value={group.members}
                  label={core.string.Members}
                  kind={'link'}
                  size={'small'}
                  allowGuests
                  onChange={(refs) => updateMembers(group, refs)}
                />
                <span class="caption-color" title={bound.map((space) => space.name).join(', ')}>{bound.length}</span>
                <ButtonIcon
                  icon={IconDelete}
                  size={'small'}
                  kind={'tertiary'}
                  tooltip={{ label: setting.string.DeleteUserGroup }}
                  on:click={() => {
                    remove(group)
                  }}
                />
              </div>
            </svelte:fragment>
          </ListView>
        </div>
      {/if}
    </SettingsCard>
  </div>
</Scroller>

<style lang="scss">
  .groupsContent {
    width: min(100%, 76rem);
  }
  .groupRow {
    display: grid;
    grid-template-columns: minmax(8rem, 1.6fr) minmax(7.5rem, 1fr) 3rem 2rem;
    min-width: 22.5rem;
    align-items: center;
    gap: var(--spacing-2);
    padding: var(--spacing-1) var(--spacing-2);
    min-height: 2.5rem;

    & > :global(*) {
      min-width: 0;
    }
  }
  // A card narrower than the row scrolls the table instead of clipping it (the card hides its overflow).
  .groupsTable {
    overflow-x: auto;
  }
</style>
