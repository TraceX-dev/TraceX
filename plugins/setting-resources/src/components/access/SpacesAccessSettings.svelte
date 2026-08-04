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
  import { type Employee, formatName } from '@hcengineering/contact'
  import { AccountArrayEditor, EmployeePresenter } from '@hcengineering/contact-resources'
  import contactResources from '@hcengineering/contact-resources/src/plugin'
  import core, { type AccountUuid, type Space } from '@hcengineering/core'
  import presentation from '@hcengineering/presentation'
  import { DataTable, Label, Loading, Scroller, SearchInput, StateTag, StateType } from '@hcengineering/ui'

  import setting from '../../plugin'
  import { getSpaceType, isSpaceOperationPending } from '../../spaceAccessUtils'

  export let spaces: Space[]
  export let employees: Employee[]
  export let spacesLoading: boolean
  export let employeesLoading: boolean
  export let pendingSpaceOperations: Set<string>
  export let updateMembers: (space: Space, members: AccountUuid[]) => Promise<boolean>
  export let handleError: (error: unknown) => void

  let search = ''

  function getOwnerEmployee (space: Space): Employee | undefined {
    return employees.find((employee) => employee.personUuid === space.owners?.[0])
  }

  function getOwnerName (space: Space): string {
    const owner = getOwnerEmployee(space)
    return owner !== undefined ? formatName(owner.name) : ''
  }

  $: visibleSpaces = spaces
    .filter((space) => {
      const query = search.trim().toLowerCase()
      if (query === '') return true
      return space.name.toLowerCase().includes(query) || getOwnerName(space).toLowerCase().includes(query)
    })
    .sort((left, right) => left.name.localeCompare(right.name))
</script>

<Scroller align={'center'} padding={'var(--spacing-4)'}>
  <div class="spacesContent">
    <h2><Label label={setting.string.Spaces} /></h2>
    <p class="hint"><Label label={setting.string.AccessControlSpacesHint} /></p>
    <div class="tableToolbar">
      <SearchInput bind:value={search} width={'18rem'} placeholder={setting.string.SearchSpaces} />
      <span>
        {#if search.trim() !== ''}{visibleSpaces.length} /
        {/if}{spaces.length}
        <Label label={setting.string.Spaces} />
      </span>
    </div>
    {#if spacesLoading || employeesLoading}
      <Loading />
    {:else if visibleSpaces.length === 0}
      <div class="emptyState"><Label label={presentation.string.NoResults} /></div>
    {:else}
      <DataTable columns="minmax(15rem, 1.6fr) 12rem minmax(12rem, 1fr)" minWidth="38rem">
        <svelte:fragment slot="header">
          <span><Label label={core.string.Name} /></span>
          <span><Label label={core.string.Members} /></span>
          <span><Label label={setting.string.Owner} /></span>
        </svelte:fragment>
        {#each visibleSpaces as space (space._id)}
          {@const owner = getOwnerEmployee(space)}
          <div class="uiDataTable-row">
            <div class="spaceName">
              <strong>{space.name}</strong>
              <span>{getSpaceType(space)}</span>
            </div>
            <div class="interactiveCell" on:click|stopPropagation role="none">
              <AccountArrayEditor
                value={space.members}
                label={core.string.Members}
                kind={'link'}
                size={'small'}
                readonly={isSpaceOperationPending(pendingSpaceOperations, space, 'members')}
                onChange={(refs) => {
                  updateMembers(space, refs).catch(handleError)
                }}
              />
            </div>
            <div class="owner">
              {#if owner !== undefined}
                <EmployeePresenter value={owner} avatarSize={'x-small'} />
              {:else}
                <StateTag type={StateType.Ghost} label={contactResources.string.Unassigned} />
              {/if}
            </div>
          </div>
        {/each}
      </DataTable>
    {/if}
  </div>
</Scroller>

<style lang="scss">
  .spacesContent {
    width: min(100%, 72rem);
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
    gap: var(--spacing-3);
    margin-bottom: var(--spacing-3);
    color: var(--theme-caption-color);
  }
  .emptyState {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 8rem;
    color: var(--theme-caption-color);
  }
  .spaceName {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .spaceName strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spaceName span {
    color: var(--theme-caption-color);
    font-size: 0.8125rem;
  }
  .interactiveCell,
  .owner {
    display: flex;
    align-items: center;
    min-width: 0;
  }
</style>
