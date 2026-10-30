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
    Loading,
    Scroller,
    SearchInput,
    showPopup
  } from '@hcengineering/ui'

  import setting from '../../plugin'

  /** All spaces of the access page: used to show and warn about the spaces a group is bound to. */
  export let spaces: Space[]
  export let groups: UserGroup[]
  export let groupsLoading: boolean
  export let handleError: (error: unknown) => void

  const client = getClient()

  let search = ''
  let newName = ''
  let creating = false

  function boundSpaces (group: Ref<UserGroup>): Space[] {
    return spaces.filter((space) => space.groups?.includes(group) === true)
  }

  async function createGroup (): Promise<void> {
    const name = newName.trim()
    if (name === '' || creating) return
    creating = true
    try {
      await client.createDoc(core.class.UserGroup, core.space.Workspace, { name, members: [] })
      newName = ''
    } catch (error) {
      handleError(error)
    } finally {
      creating = false
    }
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
    <h2><Label label={core.string.UserGroups} /></h2>
    <p class="hint"><Label label={setting.string.UserGroupsHint} /></p>
    <div class="tableToolbar">
      <SearchInput bind:value={search} width={'22rem'} placeholder={setting.string.SearchUserGroups} />
      <div class="createGroup">
        <EditBox bind:value={newName} placeholder={setting.string.NewUserGroup} kind={'default'} />
        <Button
          icon={IconAdd}
          label={presentation.string.Create}
          kind={'primary'}
          size={'medium'}
          disabled={newName.trim() === '' || creating}
          loading={creating}
          on:click={createGroup}
        />
      </div>
    </div>
    {#if groupsLoading}
      <Loading />
    {:else if visibleGroups.length === 0}
      <div class="emptyState">
        <Label label={groups.length === 0 ? setting.string.NoUserGroups : presentation.string.NoResults} />
      </div>
    {:else}
      <div class="groupsTable" role="table">
        <div class="row header" role="row">
          <span role="columnheader"><Label label={core.string.Name} /></span>
          <span role="columnheader"><Label label={core.string.Members} /></span>
          <span role="columnheader"><Label label={setting.string.Spaces} /></span>
          <span role="columnheader" />
        </div>
        {#each visibleGroups as group (group._id)}
          {@const bound = boundSpaces(group._id)}
          <div class="row" role="row" data-id={`user-group-${group.name}`}>
            <div class="cell" role="cell">
              <EditBox value={group.name} kind={'default'} on:change={(event) => rename(group, event)} />
            </div>
            <div class="cell" role="cell">
              <AccountArrayEditor
                value={group.members}
                label={core.string.Members}
                kind={'link'}
                size={'small'}
                allowGuests
                onChange={(refs) => updateMembers(group, refs)}
              />
            </div>
            <div class="cell spacesCell" role="cell" title={bound.map((space) => space.name).join(', ')}>
              {bound.length}
            </div>
            <div class="cell actions" role="cell">
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
          </div>
        {/each}
      </div>
    {/if}
  </div>
</Scroller>

<style lang="scss">
  .groupsContent {
    width: min(100%, 76rem);
  }
  h2 {
    margin: 0 0 var(--spacing-1);
  }
  .hint {
    margin: 0 0 var(--spacing-4);
    color: var(--theme-caption-color);
  }
  .tableToolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-2);
    margin-bottom: var(--spacing-4);
  }
  .createGroup {
    display: flex;
    align-items: center;
    gap: var(--spacing-1);
  }
  .emptyState {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 8rem;
    color: var(--theme-caption-color);
  }
  .groupsTable {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--border-radius-medium);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(13rem, 1.6fr) minmax(10rem, 1fr) 6rem 3rem;
    align-items: center;
    gap: var(--spacing-2);
    padding: var(--spacing-1) var(--spacing-2);
    min-height: 2.5rem;

    &:not(:last-child) {
      border-bottom: 1px solid var(--theme-divider-color);
    }
    &.header {
      color: var(--theme-caption-color);
      font-size: 0.75rem;
    }
  }
  .cell {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .spacesCell {
    color: var(--theme-caption-color);
  }
  .actions {
    justify-content: flex-end;
  }
</style>
