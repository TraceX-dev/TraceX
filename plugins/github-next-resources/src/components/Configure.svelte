<script lang="ts">
  import type { Integration as AccountIntegration } from '@hcengineering/account-client'
  import type { Class, Doc, Ref } from '@hcengineering/core'
  import githubNext, { type GithubNextRepositorySelection } from '@hcengineering/github-next'
  import type {
    IntegrationRoutingPolicy,
    IntegrationRoutingTarget,
    IntegrationSlotBinding,
    IntegrationSlotProvider,
    IntegrationValueMapping
  } from '@hcengineering/integration'
  import type { Integration as WorkspaceIntegration } from '@hcengineering/setting'
  import { createEventDispatcher, onMount } from 'svelte'
  import { Button, showPopup } from '@hcengineering/ui'
  import { authorizeGithubNext, listAuthorizedGithubRepositories, triggerGithubNextSync } from '../github'
  import {
    ensureWorkspaceGithubNextIntegration,
    getGithubNextProviderSetupById,
    getRepositoryKey,
    saveGithubNextProviderSetupById,
    upsertGithubNextIntegration
  } from '../utils'
  import IntegrationSetupEditor from '@hcengineering/integration-resources/src/components/IntegrationSetupEditor.svelte'

  export let integration: AccountIntegration | undefined

  interface IntegrationSetupResult {
    provider: Ref<IntegrationSlotProvider>
    targetClass: Ref<Class<Doc>>
    bindings: Record<string, string>
    valueMappings?: Record<string, IntegrationValueMapping>
    fallback: IntegrationRoutingTarget
  }

  const dispatch = createEventDispatcher()

  let loading = false
  let authorizing = false
  let saving = false
  let error = ''
  let info = ''
  let issueMappingMessage = ''
  let discussionMappingMessage = ''
  let accountLogin = ''
  let accountType: 'User' | 'Organization' | undefined
  let repositories: GithubNextRepositorySelection[] = []
  let selectedOwnerKeys: string[] = []
  let selectedRepositoryKeys: string[] = []
  let issues = true
  let discussions = false
  const pullRequests = false
  let workspaceIntegration: WorkspaceIntegration | undefined
  let issueProvider: IntegrationSlotProvider | undefined
  let issueBinding: IntegrationSlotBinding | undefined
  let issueRoutingPolicy: IntegrationRoutingPolicy | undefined
  let discussionProvider: IntegrationSlotProvider | undefined
  let discussionBinding: IntegrationSlotBinding | undefined
  let discussionRoutingPolicy: IntegrationRoutingPolicy | undefined

  function applyIntegrationData (): void {
    const data = integration?.data
    accountLogin = typeof data?.accountLogin === 'string' ? data.accountLogin : ''
    accountType = data?.accountType === 'User' || data?.accountType === 'Organization' ? data.accountType : undefined
    repositories = Array.isArray(data?.repositories) ? (data.repositories as GithubNextRepositorySelection[]) : []
    selectedRepositoryKeys = repositories.map((repository) => getRepositoryKey(repository))
    selectedOwnerKeys = [...new Set(repositories.map((repository) => repository.owner))]
    issues = data?.capabilities?.issues ?? true
    discussions = data?.capabilities?.discussions ?? false
  }

  function isSetupResult (value: unknown): value is IntegrationSetupResult {
    if (typeof value !== 'object' || value === null) return false
    const result = value as Partial<IntegrationSetupResult>
    return result.provider !== undefined && result.targetClass !== undefined && result.bindings !== undefined
  }

  async function loadWorkspaceSetup (): Promise<void> {
    workspaceIntegration = await ensureWorkspaceGithubNextIntegration()
    const [issueSetup, discussionSetup] = await Promise.all([
      getGithubNextProviderSetupById(workspaceIntegration, githubNext.ids.GithubNextIssueProvider),
      getGithubNextProviderSetupById(workspaceIntegration, githubNext.ids.GithubNextDiscussionProvider)
    ])
    issueProvider = issueSetup.provider
    issueBinding = issueSetup.binding
    issueRoutingPolicy = issueSetup.routingPolicy
    discussionProvider = discussionSetup.provider
    discussionBinding = discussionSetup.binding
    discussionRoutingPolicy = discussionSetup.routingPolicy
  }

  onMount(() => {
    applyIntegrationData()
    void loadWorkspaceSetup()
  })

  $: ownerGroups = Array.from(
    repositories.reduce((groups, repository) => {
      const current = groups.get(repository.owner) ?? []
      current.push(repository)
      groups.set(repository.owner, current)
      return groups
    }, new Map<string, GithubNextRepositorySelection[]>())
  )
    .map(([owner, ownerRepositories]) => ({
      owner,
      repositories: ownerRepositories.sort((left, right) => left.name.localeCompare(right.name))
    }))
    .sort((left, right) => left.owner.localeCompare(right.owner))

  $: visibleRepositories = repositories.filter((repository) => selectedOwnerKeys.includes(repository.owner))

  async function authorize (): Promise<void> {
    error = ''
    info = ''
    authorizing = true
    try {
      await authorizeGithubNext()
      info = 'GitHub authorization window opened. After authorization completes, load repositories.'
    } catch (err: any) {
      error = err?.message ?? 'Failed to start GitHub authorization.'
    } finally {
      authorizing = false
    }
  }

  async function loadRepositories (): Promise<void> {
    error = ''
    info = ''
    loading = true

    try {
      const { user, repositories: loadedRepositories } = await listAuthorizedGithubRepositories()
      accountLogin = user.login
      accountType = user.type
      repositories = loadedRepositories

      const existingKeys = new Set(selectedRepositoryKeys)
      if (existingKeys.size === 0) {
        selectedRepositoryKeys = loadedRepositories.map((repository) => getRepositoryKey(repository))
      } else {
        selectedRepositoryKeys = loadedRepositories
          .map((repository) => getRepositoryKey(repository))
          .filter((key) => existingKeys.has(key))
      }
      const existingOwners = new Set(selectedOwnerKeys)
      selectedOwnerKeys =
        existingOwners.size === 0
          ? [...new Set(loadedRepositories.map((repository) => repository.owner))]
          : [...new Set(loadedRepositories.map((repository) => repository.owner))].filter((owner) => existingOwners.has(owner))

      info = `Loaded ${loadedRepositories.length} repositories for ${user.login}.`
    } catch (err: any) {
      error = err?.message ?? 'Failed to load repositories from GitHub.'
    } finally {
      loading = false
    }
  }

  function toggleOwner (owner: string): void {
    const enabled = selectedOwnerKeys.includes(owner)
    if (enabled) {
      selectedOwnerKeys = selectedOwnerKeys.filter((item) => item !== owner)
      const repositoryKeys = new Set(
        repositories.filter((repository) => repository.owner === owner).map((repository) => getRepositoryKey(repository))
      )
      selectedRepositoryKeys = selectedRepositoryKeys.filter((key) => !repositoryKeys.has(key))
    } else {
      selectedOwnerKeys = [...selectedOwnerKeys, owner]
    }
  }

  function toggleRepository (repository: GithubNextRepositorySelection): void {
    const key = getRepositoryKey(repository)
    selectedRepositoryKeys = selectedRepositoryKeys.includes(key)
      ? selectedRepositoryKeys.filter((item) => item !== key)
      : [...selectedRepositoryKeys, key]
  }

  async function save (): Promise<void> {
    const selectedRepositories = visibleRepositories.filter((repository) =>
      selectedRepositoryKeys.includes(getRepositoryKey(repository))
    )

    if (selectedRepositories.length === 0) {
      error = 'Select at least one repository.'
      return
    }

    if (accountLogin === '') {
      error = 'Authorize GitHub and load repositories before saving.'
      return
    }

    saving = true
    error = ''

    try {
      await upsertGithubNextIntegration(
        integration,
        selectedRepositories,
        { issues, discussions, pullRequests },
        accountLogin,
        accountType
      )
      workspaceIntegration = await ensureWorkspaceGithubNextIntegration()
      await loadWorkspaceSetup()
      try {
        await triggerGithubNextSync()
        info = 'Account integration saved. Sync has been scheduled.'
      } catch (syncErr: any) {
        info = `Account integration saved. Sync was not scheduled: ${syncErr?.message ?? 'unknown error'}.`
      }
    } catch (err: any) {
      error = err?.message ?? 'Failed to save GitHub Next integration.'
    } finally {
      saving = false
    }
  }

  function openMappingSetup (
    provider: IntegrationSlotProvider | undefined,
    binding: IntegrationSlotBinding | undefined,
    routingPolicy: IntegrationRoutingPolicy | undefined,
    kind: 'issue' | 'discussion'
  ): void {
    if (provider === undefined || workspaceIntegration === undefined) {
      if (kind === 'issue') issueMappingMessage = 'Workspace integration or provider is missing.'
      else discussionMappingMessage = 'Workspace integration or provider is missing.'
      return
    }

    showPopup(
      IntegrationSetupEditor,
      {
        provider,
        binding,
        routingPolicy
      },
      'top',
      async (result) => {
        if (!isSetupResult(result) || workspaceIntegration === undefined) {
          return
        }

        const saved = await saveGithubNextProviderSetupById(workspaceIntegration, {
          provider: result.provider,
          targetClass: result.targetClass,
          bindings: result.bindings,
          valueMappings: result.valueMappings,
          fallback: result.fallback
        })
        if (kind === 'issue') {
          issueBinding = saved.binding
          issueRoutingPolicy = saved.policy
          issueMappingMessage = 'Issue mapping saved.'
        } else {
          discussionBinding = saved.binding
          discussionRoutingPolicy = saved.policy
          discussionMappingMessage = 'Discussion mapping saved.'
        }
      }
    )
  }
</script>

<div class="card">
  <div class="header">
    <div class="title">GitHub Next</div>
    <button
      class="close-button"
      type="button"
      on:click={() => {
        dispatch('close')
      }}
    >
      x
    </button>
  </div>

  <div class="content">
    <div class="actions">
      <Button label={'Authorize GitHub'} kind={'primary'} loading={authorizing} on:click={authorize} />
      <Button label={'Load repositories'} kind={'secondary'} disabled={loading} on:click={loadRepositories} />
    </div>

    <div class="identity">
      {#if accountLogin !== ''}
        <span>{accountLogin}</span>
        {#if accountType !== undefined}
          <span class="muted">{accountType}</span>
        {/if}
      {/if}
    </div>

    <div class="capabilities">
      <label><input bind:checked={issues} type="checkbox" /> Issues</label>
      <label><input bind:checked={discussions} type="checkbox" /> Discussions</label>
    </div>

    <div class="repository-picker">
      {#if repositories.length === 0}
        <div class="muted">No repositories loaded yet.</div>
      {:else}
        <section class="selection-section">
          <div class="section-header">
            <span>Organizations</span>
            <span class="muted">{selectedOwnerKeys.length}/{ownerGroups.length}</span>
          </div>
          <div class="owner-grid">
            {#each ownerGroups as group (group.owner)}
              <label class:selected={selectedOwnerKeys.includes(group.owner)} class="owner-option">
                <input
                  checked={selectedOwnerKeys.includes(group.owner)}
                  type="checkbox"
                  on:change={() => toggleOwner(group.owner)}
                />
                <span class="owner-name">{group.owner}</span>
                <span class="muted">{group.repositories.length}</span>
              </label>
            {/each}
          </div>
        </section>

        <section class="selection-section">
          <div class="section-header">
            <span>Repositories</span>
            <span class="muted">{selectedRepositoryKeys.length}/{visibleRepositories.length}</span>
          </div>
          <div class="repositories">
            {#if visibleRepositories.length === 0}
              <div class="muted">Select an organization first.</div>
            {:else}
              {#each visibleRepositories as repository (getRepositoryKey(repository))}
                <label class:selected={selectedRepositoryKeys.includes(getRepositoryKey(repository))} class="repository">
                  <input
                    checked={selectedRepositoryKeys.includes(getRepositoryKey(repository))}
                    type="checkbox"
                    on:change={() => toggleRepository(repository)}
                  />
                  <span class="repository-name">{repository.name}</span>
                  <span class="muted">{repository.owner}</span>
                </label>
              {/each}
            {/if}
          </div>
        </section>
      {/if}
    </div>

    <div class="mapping">
      <div class="mapping-row">
        <div class="mapping-copy">
          <div class="mapping-title">Issue mapping</div>
          <div class="muted">
            {#if issueRoutingPolicy !== undefined && issueBinding !== undefined}
              Configured
            {:else}
              Not configured yet
            {/if}
          </div>
        </div>
        <Button
          label={'Configure mapping'}
          kind={'secondary'}
          on:click={() => openMappingSetup(issueProvider, issueBinding, issueRoutingPolicy, 'issue')}
        />
      </div>
      {#if issueMappingMessage !== ''}
        <div class="info">{issueMappingMessage}</div>
      {/if}
      <div class="mapping-row">
        <div class="mapping-copy">
          <div class="mapping-title">Discussion mapping</div>
          <div class="muted">
            {#if discussionRoutingPolicy !== undefined && discussionBinding !== undefined}
              Configured
            {:else}
              Not configured yet
            {/if}
          </div>
        </div>
        <Button
          label={'Configure mapping'}
          kind={'secondary'}
          on:click={() => openMappingSetup(discussionProvider, discussionBinding, discussionRoutingPolicy, 'discussion')}
        />
      </div>
      {#if discussionMappingMessage !== ''}
        <div class="info">{discussionMappingMessage}</div>
      {/if}
    </div>

    {#if info !== ''}
      <div class="info">{info}</div>
    {/if}
    {#if error !== ''}
      <div class="error">{error}</div>
    {/if}
  </div>

  <div class="footer">
    <Button label={'Save'} kind={'primary'} loading={saving} on:click={save} />
  </div>
</div>

<style lang="scss">
  .card {
    display: flex;
    flex-direction: column;
    width: min(36rem, calc(100vw - 2rem));
    max-height: min(44rem, calc(100vh - 2rem));
    background: var(--popup-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.75rem;
    box-shadow: var(--popup-shadow);
  }

  .header,
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
  }

  .title {
    font-size: 1rem;
    font-weight: 600;
  }

  .close-button {
    border: 0;
    background: transparent;
    color: var(--theme-caption-color);
    cursor: pointer;
    font-size: 1rem;
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding: 0 1.25rem 1rem;
    overflow: auto;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .field input {
    width: 100%;
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    background: var(--theme-bg-color);
    color: var(--theme-text-color);
  }

  .actions,
  .identity,
  .capabilities {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .repository-picker {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .selection-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    font-weight: 600;
  }

  .owner-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.5rem;
    max-height: 8rem;
    overflow: auto;
  }

  .repositories {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 12rem;
    overflow: auto;
  }

  .owner-option,
  .repository {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-height: 2.25rem;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    background: var(--theme-bg-color);
  }

  .owner-option.selected,
  .repository.selected {
    border-color: var(--theme-button-default);
  }

  .owner-name,
  .repository-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
  }

  .mapping {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--theme-divider-color);
  }

  .mapping-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .mapping-copy {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .mapping-title {
    font-weight: 600;
  }

  .muted,
  .info {
    color: var(--theme-caption-color);
  }

  .error {
    color: var(--theme-error-color);
  }
</style>
