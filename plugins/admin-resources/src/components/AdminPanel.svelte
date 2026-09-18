<script lang="ts">
  import { adminId } from '@hcengineering/admin'
  import contact from '@hcengineering/contact'
  import { loginId } from '@hcengineering/login'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { isAdminUser } from '@hcengineering/presentation'
  import { getAccount, getAccountDisplayName } from '@hcengineering/login-resources'
  import { logOut } from '@hcengineering/workbench'
  import {
    Component,
    Button,
    IconSettings,
    Label,
    Menu,
    NavItem,
    Scroller,
    Separator,
    defineSeparators,
    location,
    navigate,
    showPopup,
    twoPanelsSeparators
  } from '@hcengineering/ui'
  import { onDestroy, onMount } from 'svelte'
  import AdminAccounts from './AdminAccounts.svelte'
  import AdminWorkspaces from './AdminWorkspaces.svelte'

  type AdminSection = 'workspaces' | 'accounts'

  let section: AdminSection = 'workspaces'
  let accountName = ''
  const isAdmin = isAdminUser()

  defineSeparators('admin', twoPanelsSeparators)

  onDestroy(
    location.subscribe((loc) => {
      section = loc.path[1] === 'accounts' || loc.path[1] === 'users' ? 'accounts' : 'workspaces'
    })
  )

  function selectSection (value: AdminSection): void {
    navigate({ path: [adminId, value] })
  }

  onMount(() => {
    if (!isAdmin) navigate({ path: [loginId, 'selectWorkspace'] })
    void getAccount(false).then((account) => {
      accountName = getAccountDisplayName(account)
    })
  })

  function showAccountMenu (event: MouseEvent): void {
    showPopup(
      Menu,
      {
        actions: [
          {
            label: getEmbeddedLabel('Log out'),
            action: async () => {
              await logOut()
            }
          }
        ]
      },
      event.currentTarget as HTMLElement
    )
  }
</script>

{#if isAdmin}
  <div class="admin-panel">
    <aside class="antiPanel-application vertical no-print">
      <div class="admin-panel__application-top" />
      <div class="admin-panel__application-bottom">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="cursor-pointer" on:click|stopPropagation={showAccountMenu}>
          <Component is={contact.component.Avatar} props={{ name: accountName, size: 'small', showStatus: true }} />
        </div>
      </div>
    </aside>
    <aside class="antiPanel-navigator border-left">
      <div class="antiPanel-wrap__content hulyNavPanel-container">
        <div class="hulyNavPanel-header">
          <Label label={getEmbeddedLabel('Administration')} />
        </div>
        <Scroller shrink>
          <NavItem
            label={getEmbeddedLabel('Workspaces')}
            selected={section === 'workspaces'}
            on:click={() => {
              selectSection('workspaces')
            }}
          />
          <NavItem
            label={getEmbeddedLabel('Accounts')}
            selected={section === 'accounts'}
            on:click={() => {
              selectSection('accounts')
            }}
          />
        </Scroller>
      </div>
      <Separator name={'admin'} float={true} index={0} color={'transparent'} />
    </aside>
    <Separator name={'admin'} float={false} index={0} color={'var(--theme-divider-color)'} />
    <main class="antiPanel-component filledNav">
      {#if section === 'accounts'}
        <AdminAccounts />
      {:else}
        <AdminWorkspaces />
      {/if}
    </main>
  </div>
{/if}

<style lang="scss">
  .admin-panel {
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: var(--theme-panel-color);

    &:not(.inner)::after {
      position: absolute;
      content: '';
      inset: 0;
      border: 1px solid var(--theme-divider-color);
      border-radius: var(--medium-BorderRadius);
      pointer-events: none;
    }
  }

  .admin-panel .antiPanel-component {
    flex: 1;
    min-width: 0;
  }

  .admin-panel__application-top,
  .admin-panel__application-bottom {
    display: flex;
    justify-content: center;
    padding: 0.5rem;
  }

  .admin-panel__application-bottom {
    margin-top: auto;
    margin-bottom: 0.5rem;
  }

  .antiPanel-application.horizontal {
    border-radius: 0 0 var(--medium-BorderRadius) var(--medium-BorderRadius);
    border-top: none;
  }

  .antiPanel-application:not(.horizontal) {
    border-radius: var(--medium-BorderRadius) 0 0 var(--medium-BorderRadius);
    border-right: none;
  }
</style>
