<!--
// Copyright © 2020 Anticrm Platform Contributors.
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
  import { createEventDispatcher } from 'svelte'
  import core, { AccountRole, getCurrentAccount, type ModulePermissionGroup, type Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { Scroller, deviceOptionsStore as deviceInfo } from '@hcengineering/ui'
  import { NavLink } from '@hcengineering/view-resources'
  import type { Application } from '@hcengineering/workbench'
  import workbench from '@hcengineering/workbench'
  import { getMetadata, getResource } from '@hcengineering/platform'
  import { InboxNotificationsClientImpl } from '@hcengineering/notification-resources'
  import notification, { DocNotifyContext, InboxNotification, notificationId } from '@hcengineering/notification'

  import AppItem from './AppItem.svelte'

  export let active: Ref<Application> | undefined
  export let apps: Application[] = []
  export let direction: 'vertical' | 'horizontal' = 'vertical'
  export let customAppProps: Map<string, any> = new Map<string, any>()

  const dispatch = createEventDispatcher()

  const account = getCurrentAccount()

  function getClickHandler (app: Application, customProps: any) {
    return (
      customProps.onClick ??
      (() => {
        if (app._id === active) dispatch('toggleNav')
      })
    )
  }

  let loaded: boolean = false
  let permissionsLoaded: boolean = false
  let hiddenAppsIds: Array<Ref<Application>> = []
  let excludedApps: string[] = []
  let disabledApplications: Set<Ref<Application>> = new Set<Ref<Application>>()

  const hiddenAppsIdsQuery = createQuery()
  const modulePermissionGroupsQuery = createQuery()
  modulePermissionGroupsQuery.query(core.class.ModulePermissionGroup, {}, (res) => {
    try {
      const modulePermissionGroups = res as ModulePermissionGroup[]
      disabledApplications = new Set<Ref<Application>>(
        modulePermissionGroups.filter(checkPermissionGroup).map((g) => g.application as Ref<Application>)
      )
    } catch (error) {
      console.error('Error loading module permission groups:', error)
    } finally {
      permissionsLoaded = true
    }
  })

  function checkPermissionGroup (group: ModulePermissionGroup): boolean {
    if (group.enabled ?? true) {
      return false
    }
    if (account.role === group.role) {
      return true
    }
    // DocGuest should also respect Guest module disables.
    return account.role === AccountRole.DocGuest && group.role === AccountRole.Guest
  }

  hiddenAppsIdsQuery.query(
    workbench.class.HiddenApplication,
    {
      space: core.space.Workspace
    },
    (res) => {
      hiddenAppsIds = res.map((r) => r.attachedTo)
      loaded = true
    }
  )

  function updateExcludedApps (): void {
    const me = getCurrentAccount()

    if (me.role === AccountRole.ReadOnlyGuest || me.role === AccountRole.Guest) {
      excludedApps = getMetadata(workbench.metadata.ExcludedApplicationsForAnonymous) ?? []
    } else {
      excludedApps = []
    }
  }

  updateExcludedApps()

  let topApps: Application[] = []
  let midApps: Application[] = []
  let bottomApps: Application[] = []

  // Single reactive block so reads of hiddenAppsIds / excludedApps / disabledApplications
  $: {
    const hidden = hiddenAppsIds
    const excluded = excludedApps
    const disabled = disabledApplications

    const isApplicationVisibleInSidebar = (app: Application): boolean =>
      !hidden.includes(app._id) && !excluded.includes(app.alias) && !disabled.has(app._id)

    topApps = apps
      .filter((it) => it.position === 'top' && isApplicationVisibleInSidebar(it))
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    midApps = apps
      .filter((it) => it.position !== 'top' && it.position !== 'bottom' && isApplicationVisibleInSidebar(it))
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    bottomApps = apps.filter((it) => it.position === 'bottom' && isApplicationVisibleInSidebar(it))
  }

  const inboxClient = InboxNotificationsClientImpl.getClient()
  const inboxNotificationsByContextStore = inboxClient.inboxNotificationsByContext

  let hasNotificationsFn: ((data: Map<Ref<DocNotifyContext>, InboxNotification[]>) => Promise<boolean>) | undefined =
    undefined
  let hasInboxNotifications = false

  void getResource(notification.function.HasInboxNotifications).then((f) => {
    hasNotificationsFn = f
  })

  $: void hasNotificationsFn?.($inboxNotificationsByContextStore).then((res) => {
    hasInboxNotifications = res
  })

  function showNotify (alias: string, hasInboxNotifications: boolean): boolean {
    if (alias === notificationId) {
      return hasInboxNotifications
    }
    return false
  }
</script>

<div class="flex-{direction === 'horizontal' ? 'row-center' : 'col-center'} clear-mins apps-{direction} relative">
  {#if loaded && permissionsLoaded}
    <Scroller
      invertScroll
      padding={direction === 'horizontal' ? '.75rem .5rem' : '.5rem .75rem'}
      gap={direction === 'horizontal' ? 'gap-1' : 'gapV-1'}
      horizontal={direction === 'horizontal'}
      contentDirection={direction}
      align={direction === 'horizontal' ? 'center' : 'start'}
      buttons={'union'}
    >
      {#each topApps as app}
        {@const customProps = customAppProps.get(app.alias) ?? {}}
        <NavLink app={app.alias} shrink={0} disabled={app._id === active}>
          <AppItem
            selected={app._id === active}
            icon={app.icon}
            label={app.label}
            navigator={app._id === active && $deviceInfo.navigator.visible}
            notify={showNotify(app.alias, hasInboxNotifications)}
            {...customProps}
            dataId={`app-sidebar-${app.alias}`}
            on:click={getClickHandler(app, customProps)}
          />
        </NavLink>
      {/each}
      {#if topApps.length > 0}
        <div class="divider" />
      {/if}
      {#each midApps as app}
        {@const customProps = customAppProps.get(app.alias) ?? {}}
        <NavLink app={app.alias} shrink={0} disabled={app._id === active}>
          <AppItem
            selected={app._id === active}
            icon={app.icon}
            label={app.label}
            navigator={app._id === active && $deviceInfo.navigator.visible}
            {...customProps}
            dataId={`app-sidebar-${app.alias}`}
            on:click={getClickHandler(app, customProps)}
          />
        </NavLink>
      {/each}
      {#if bottomApps.length > 0}
        <div class="divider" />
        {#each bottomApps as app}
          {@const customProps = customAppProps.get(app.alias) ?? {}}
          <NavLink app={app.alias} shrink={0} disabled={app._id === active}>
            <AppItem
              selected={app._id === active}
              icon={app.icon}
              label={app.label}
              navigator={app._id === active && $deviceInfo.navigator.visible}
              {...customProps}
              dataId={`app-sidebar-${app.alias}`}
              on:click={getClickHandler(app, customProps)}
            />
          </NavLink>
        {/each}
      {/if}
      <div class="apps-space-{direction}" />
    </Scroller>
  {/if}
</div>

<style lang="scss">
  .apps-horizontal {
    justify-content: center;
    margin: 0 0.5rem 0 0.25rem;
    height: var(--app-panel-width);
    min-height: 4rem;

    .divider {
      margin-left: 0.5rem;
      width: 1px;
      height: 2.25rem;
    }
  }
  .apps-vertical {
    margin-bottom: 0.5rem;
    width: var(--app-panel-width);
    min-width: 4rem;

    .divider {
      margin-top: 1rem;
      width: 2.25rem;
      height: 1px;
    }
  }
  .divider {
    flex-shrink: 0;
    background-color: var(--theme-navpanel-icons-divider);
  }
  .apps-space {
    &-vertical {
      min-height: 0.5rem;
      height: 0.5rem;
    }
    &-horizontal {
      min-width: 0.5rem;
      width: 0.5rem;
    }
  }
</style>
