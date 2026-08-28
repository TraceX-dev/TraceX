<!--
// Copyright © 2024, 2025 Hardcore Engineering Inc.
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
  import {
    groupByArray,
    isActiveMode,
    isArchivingMode,
    isDeletingMode,
    reduceCalls,
    type WorkspaceInfoWithStatus
  } from '@hcengineering/core'
  import { getEmbeddedLabel, getMetadata } from '@hcengineering/platform'
  import presentation, {
    copyTextToClipboard,
    isAdminUser,
    MessageBox,
    type OverviewStatistics
  } from '@hcengineering/presentation'
  import {
    Button,
    CheckBox,
    Expandable,
    IconArchive,
    IconCopy,
    IconDelete,
    IconDownOutline,
    IconOpen,
    IconStart,
    locationToUrl,
    Popup,
    Scroller,
    SearchEdit,
    showPopup,
    Switcher,
    ticker
  } from '@hcengineering/ui'
  import { workbenchId } from '@hcengineering/workbench'
  import { getAllWorkspaces, performWorkspaceOperation } from '@hcengineering/login-resources'
  import Table from './table/Table.svelte'

  $: now = $ticker

  $: isAdmin = isAdminUser()

  let search: string = ''

  async function select (workspace: string): Promise<void> {
    const url = locationToUrl({ path: [workbenchId, workspace] })
    window.open(url, '_blank')
  }

  type WorkspaceInfo = WorkspaceInfoWithStatus & { processingAttempts: number }

  interface WorkspaceTableColumn {
    id: string
    label: import('@hcengineering/platform').IntlString
    getValue: (row: unknown) => string | number | boolean | null | undefined
    sortable?: boolean
  }

  const workspaceColumns: WorkspaceTableColumn[] = [
    { id: 'workspace', label: getEmbeddedLabel('Workspace'), getValue: (row) => asWorkspace(row).name, sortable: true },
    { id: 'region', label: getEmbeddedLabel('Region'), getValue: (row) => asWorkspace(row).region, sortable: true },
    {
      id: 'activity',
      label: getEmbeddedLabel('Last activity'),
      getValue: (row) => asWorkspace(row).lastVisit ?? 0,
      sortable: true
    },
    { id: 'status', label: getEmbeddedLabel('Status'), getValue: (row) => asWorkspace(row).mode, sortable: true },
    {
      id: 'attempts',
      label: getEmbeddedLabel('Attempts'),
      getValue: (row) => asWorkspace(row).processingAttempts,
      sortable: true
    },
    {
      id: 'progress',
      label: getEmbeddedLabel('Progress'),
      getValue: (row) => asWorkspace(row).processingProgress,
      sortable: true
    },
    {
      id: 'backupSize',
      label: getEmbeddedLabel('Backup size'),
      getValue: (row) => {
        const backupInfo = asWorkspace(row).backupInfo
        return Math.max(backupInfo?.backupSize ?? 0, (backupInfo?.dataSize ?? 0) + (backupInfo?.blobsSize ?? 0))
      },
      sortable: true
    },
    {
      id: 'lastBackup',
      label: getEmbeddedLabel('Last backup'),
      getValue: (row) => asWorkspace(row).backupInfo?.lastBackup ?? 0,
      sortable: true
    },
    { id: 'actions', label: getEmbeddedLabel('Actions'), getValue: () => '' }
  ]

  function asWorkspace (row: unknown): WorkspaceInfo {
    return row as WorkspaceInfo
  }

  let workspaces: WorkspaceInfo[] = []

  type WorkspaceSection = 'active' | 'inactive' | 'unused'

  let selectedSection: WorkspaceSection = 'active'

  const workspaceSections = [
    { id: 'active', labelIntl: getEmbeddedLabel('Active') },
    { id: 'inactive', labelIntl: getEmbeddedLabel('Inactive') },
    { id: 'unused', labelIntl: getEmbeddedLabel('Unused') }
  ]

  const updateWorkspaces = reduceCalls(async (_: number) => {
    const res = await getAllWorkspaces()
    workspaces = res as WorkspaceInfo[]
  })

  $: void updateWorkspaces($ticker)

  $: sortedWorkspaces = workspaces.filter(
    (it) =>
      (it.name?.includes(search) ?? false) ||
      (it.url?.includes(search) ?? false) ||
      it.uuid?.includes(search) ||
      it.createdBy?.includes(search)
  )

  let backupIdx = new Map<string, number>()

  const backupInterval: number = 43200

  const token: string = getMetadata(presentation.metadata.Token) ?? ''

  const endpoint = getMetadata(presentation.metadata.StatsUrl)

  async function fetchStats (time: number): Promise<void> {
    await fetch(endpoint + `/api/v1/overview?token=${token}`, {})
      .then(async (json) => {
        data = await json.json()
      })
      .catch((err) => {
        console.error(err)
      })
  }
  let data: OverviewStatistics | undefined
  $: void fetchStats($ticker)

  $: statsByWorkspace = new Map((data?.workspaces ?? []).map((it) => [it.wsId, it]))

  $: {
    // Assign backup idx
    const backupSorting = [...workspaces].filter((it) => {
      if (!isActiveMode(it.mode)) {
        return false
      }
      const lastBackup = it.backupInfo?.lastBackup ?? 0
      if ((now - lastBackup) / 1000 < backupInterval) {
        // No backup required, interval not elapsed
        return false
      }

      const createdOn = Math.floor((now - it.createdOn) / 1000)
      if (createdOn <= 2) {
        // Skip if we created is less 2 days
        return false
      }
      if (it.lastVisit == null) {
        return false
      }

      const lastVisitSec = Math.floor((now - it.lastVisit) / 1000)
      if (lastVisitSec > backupInterval) {
        // No backup required, interval not elapsed
        return false
      }
      return true
    })
    const newBackupIdx = new Map<string, number>()

    backupSorting.sort((a, b) => {
      return (a.backupInfo?.lastBackup ?? 0) - (b.backupInfo?.lastBackup ?? 0)
    })

    // Shift new with existing ones.
    const existingNew = groupByArray(backupSorting, (it) => it.backupInfo != null)

    const existing = existingNew.get(true) ?? []
    const newOnes = existingNew.get(false) ?? []
    const mixedBackupSorting: WorkspaceInfo[] = []

    while (existing.length > 0 || newOnes.length > 0) {
      const e = existing.shift()
      const n = newOnes.shift()
      if (e != null) {
        mixedBackupSorting.push(e)
      }
      if (n != null) {
        mixedBackupSorting.push(n)
      }
    }

    for (const [idx, it] of mixedBackupSorting.entries()) {
      newBackupIdx.set(it.uuid, idx)
    }
    backupIdx = newBackupIdx
  }

  const dayRanges = {
    Hour: [-1, 0.1],
    Day: [0.1, 1],
    Week: [1, 7],
    Month: [7, 30],
    Months1: [30, 60],
    Months2: [60, 90],
    Months3: [90, 180],
    'Six Month': [180, 270],
    'Nine Months': [270, 365],
    Years: [365, 10000000]
  }

  $: sectionWorkspaces = sortedWorkspaces.filter((workspace) => {
    const lastVisit = workspace.lastVisit ?? 0
    const isRecentlyUsed = now - lastVisit < 1000 * 3600 * 24
    if (selectedSection === 'active') return isActiveMode(workspace.mode) && isRecentlyUsed
    if (selectedSection === 'inactive') return !isActiveMode(workspace.mode)
    return isActiveMode(workspace.mode) && !isRecentlyUsed
  })

  $: groupped = groupByArray(sectionWorkspaces, (it) => {
    const lastUsageDays = Math.round((10 * (now - (it.lastVisit ?? 0))) / (1000 * 3600 * 24)) / 10
    return Object.entries(dayRanges).find(([_k, v]) => v[0] < lastUsageDays && lastUsageDays <= v[1])?.[0] ?? 'Years'
  })

  $: groupKeys = selectedSection === 'unused' ? Object.keys(dayRanges) : [selectedSection]
  $: if (selectedSection !== 'unused') {
    groupped = new Map([[selectedSection, sectionWorkspaces]])
  }

  let superAdminMode = false

  function selectSection (event: CustomEvent<{ id: string | number }>): void {
    selectedSection = event.detail.id as WorkspaceSection
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
{#if isAdmin}
  <Scroller>
    <div class="flex-column flex-grow p-5">
      <div class="anticrm-panel flex-row flex-grow" style:overflow-y={'auto'}>
        <div class="flex-between">
          <div class="fs-title p-3">Workspaces</div>
          <div class="flex-row-center flex-gap-4">
            <div class="flex-row-center">
              <span class="mr-4">Enable deletion</span>
              <CheckBox bind:checked={superAdminMode} />
            </div>
            <Switcher
              kind={'subtle'}
              items={workspaceSections}
              selected={selectedSection}
              name={'workspace-section'}
              on:select={selectSection}
            />
          </div>
        </div>
        <div class="p-3 flex-no-shrink">
          <SearchEdit bind:value={search} width={'100%'} />
        </div>

        <div class="p-1 select-text-i">
          <Scroller maxHeight={40} noStretch={true}>
            <div class="mr-4">
              {#each groupKeys as k}
                {@const v = groupped.get(k) ?? []}
                {@const activeAll = v.filter((it) => isActiveMode(it.mode))}
                {@const archivedV = v.filter((it) => isArchivingMode(it.mode))}
                {@const deletedV = v.filter((it) => isDeletingMode(it.mode))}
                {@const maintenance = v.length - activeAll.length - archivedV.length - deletedV.length}
                {#if v.length > 0}
                  <Expandable
                    expandable={selectedSection === 'unused'}
                    bordered={selectedSection !== 'active'}
                    expanded={selectedSection !== 'unused' || search.trim().length > 0}
                    showHeader={selectedSection !== 'active'}
                  >
                    <svelte:fragment slot="title">
                      <span class="fs-title focused-button flex-row-center">
                        {k} -
                        {v.length}
                        {#if maintenance > 0}
                          - maitenance: {maintenance}
                        {/if}
                      </span>
                    </svelte:fragment>
                    <svelte:fragment slot="tools">
                      {#if activeAll.length > 0}
                        <Button
                          icon={IconArchive}
                          label={getEmbeddedLabel(`Mass Archive ${activeAll.length}`)}
                          kind={'ghost'}
                          on:click={() => {
                            showPopup(MessageBox, {
                              label: getEmbeddedLabel(`Mass Archive ${activeAll.length}`),
                              message: getEmbeddedLabel(`Please confirm archive ${activeAll.length} workspaces`),
                              action: async () => {
                                void performWorkspaceOperation(
                                  activeAll.map((it) => it.uuid),
                                  'archive'
                                )
                              }
                            })
                          }}
                        />
                      {/if}
                    </svelte:fragment>
                    <div class="workspace-group-table">
                      <Table columns={workspaceColumns} data={v} let:row let:column>
                        {@const workspace = asWorkspace(row)}
                        {@const lastUsageDays = Math.round((now - (workspace.lastVisit ?? 0)) / (1000 * 3600 * 24))}
                        {@const bIdx = backupIdx.get(workspace.uuid)}
                        {@const stats = statsByWorkspace.get(workspace.uuid ?? '')}
                        {#if column.id === 'workspace'}
                          <div class="flex-row-center flex-between">
                            <span>{workspace.name}</span>
                            <div class="flex-row-center flex-gap-2">
                              {#if stats}
                                <span class="ml-1"
                                  >{stats.sessions?.length ?? 0} / {(stats.sessions ?? []).reduceRight(
                                    (p, it) => p + (it.mins5.tx + it.mins5.find) + (it.current.tx + it.current.find),
                                    0
                                  )}</span
                                >
                              {/if}
                              <Button
                                icon={IconOpen}
                                size={'small'}
                                on:click={() => select(workspace.url)}
                                showTooltip={{ label: getEmbeddedLabel('Open Workspace URL') }}
                              />
                              <Button
                                icon={IconCopy}
                                size={'small'}
                                on:click={() => copyTextToClipboard(workspace.uuid)}
                                showTooltip={{ label: getEmbeddedLabel('Copy UUID') }}
                              />
                            </div>
                          </div>
                        {:else if column.id === 'region'}
                          {workspace.region ?? ''}
                        {:else if column.id === 'activity'}
                          {lastUsageDays} days
                        {:else if column.id === 'status'}
                          {workspace.mode ?? '-'}
                        {:else if column.id === 'attempts'}
                          <div class="flex-row-center">
                            {workspace.processingAttempts}
                            {#if workspace.processingAttempts > 0}
                              <Button
                                on:click={() => {
                                  showPopup(MessageBox, {
                                    label: getEmbeddedLabel(`Reset attempts ${workspace.url}`),
                                    message: getEmbeddedLabel('Please confirm'),
                                    action: async () => {
                                      await performWorkspaceOperation(workspace.uuid, 'reset-attempts')
                                    }
                                  })
                                }}
                                icon={IconDownOutline}
                                size={'small'}
                                kind={'ghost'}
                                showTooltip={{ label: getEmbeddedLabel('Reset attempts') }}
                              />
                            {/if}
                          </div>
                        {:else if column.id === 'progress'}
                          {#if workspace.processingProgress !== 100 && workspace.processingProgress !== 0}
                            {workspace.processingProgress}%
                          {/if}
                        {:else if column.id === 'backupSize'}
                          {#if workspace.backupInfo != null}
                            {@const sz = Math.max(
                              workspace.backupInfo.backupSize,
                              workspace.backupInfo.dataSize + workspace.backupInfo.blobsSize
                            )}
                            {@const szGb = Math.round((sz * 100) / 1024) / 100}
                            {#if szGb > 0}
                              {Math.round((sz * 100) / 1024) / 100}Gb
                            {:else}
                              {Math.round(sz * 100) / 100}Mb
                            {/if}
                          {/if}
                          {#if bIdx != null}[#{bIdx}]{/if}
                        {:else if column.id === 'lastBackup'}
                          {#if workspace.backupInfo != null}
                            {@const hours = Math.round((now - workspace.backupInfo.lastBackup) / (1000 * 3600))}
                            {#if hours > 24}
                              {Math.round(hours / 24)} days
                            {:else}
                              {hours} hours
                            {/if}
                          {/if}
                        {:else if column.id === 'actions'}
                          <div class="flex-row-center">
                            {#if workspace.mode === 'active'}
                              <Button
                                icon={IconArchive}
                                size={'small'}
                                kind={'ghost'}
                                showTooltip={{ label: getEmbeddedLabel('Archive') }}
                                on:click={() => {
                                  showPopup(MessageBox, {
                                    label: getEmbeddedLabel(`Archive ${workspace.url}`),
                                    message: getEmbeddedLabel('Please confirm'),
                                    action: async () => {
                                      await performWorkspaceOperation(workspace.uuid, 'archive')
                                    }
                                  })
                                }}
                              />
                            {/if}
                            {#if workspace.mode === 'archived'}
                              <Button
                                icon={IconStart}
                                size={'small'}
                                kind={'ghost'}
                                showTooltip={{ label: getEmbeddedLabel('Unarchive') }}
                                on:click={() => {
                                  showPopup(MessageBox, {
                                    label: getEmbeddedLabel(`Unarchive ${workspace.url}`),
                                    message: getEmbeddedLabel('Please confirm'),
                                    action: async () => {
                                      await performWorkspaceOperation(workspace.uuid, 'unarchive')
                                    }
                                  })
                                }}
                              />
                            {/if}
                            {#if superAdminMode && !isDeletingMode(workspace.mode) && !isArchivingMode(workspace.mode)}
                              <Button
                                icon={IconDelete}
                                size={'small'}
                                kind={'dangerous'}
                                showTooltip={{ label: getEmbeddedLabel('Delete') }}
                                on:click={() => {
                                  showPopup(MessageBox, {
                                    label: getEmbeddedLabel(`Delete ${workspace.url}`),
                                    message: getEmbeddedLabel('Please confirm'),
                                    action: async () => {
                                      await performWorkspaceOperation(workspace.uuid, 'delete')
                                    }
                                  })
                                }}
                              />
                            {/if}
                          </div>
                        {/if}
                      </Table>
                    </div>
                  </Expandable>
                {/if}
              {/each}
            </div>
          </Scroller>
        </div>
      </div>
    </div>
  </Scroller>
  <Popup />
{/if}

<style lang="scss">
  .workspace-group-table {
    margin-bottom: 0.75rem;
  }
</style>
