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
  import { onDestroy } from 'svelte'
  import type { Ref } from '@hcengineering/core'
  import { getResource } from '@hcengineering/platform'
  import type { Application, ApplicationNotificationState } from '@hcengineering/workbench'
  import { deviceOptionsStore as deviceInfo } from '@hcengineering/ui'
  import { NavLink } from '@hcengineering/view-resources'

  import AppItem from './AppItem.svelte'

  export let active: Ref<Application> | undefined
  export let app: Application
  export let customProps: Record<string, unknown> = {}

  let notificationState: ApplicationNotificationState = { notify: false }
  let unsubscribe: (() => void) | undefined
  let requestId = 0

  $: void subscribeToNotifications(app.notificationProvider)

  async function subscribeToNotifications (provider: Application['notificationProvider']): Promise<void> {
    const currentRequestId = ++requestId
    unsubscribe?.()
    unsubscribe = undefined
    notificationState = { notify: false }

    if (provider === undefined) return

    try {
      const createNotificationStore = await getResource(provider)
      if (currentRequestId !== requestId) return

      unsubscribe = createNotificationStore().subscribe((state) => {
        if (currentRequestId === requestId) notificationState = state
      })
    } catch (error) {
      console.error('Error subscribing to application notifications:', error)
    }
  }

  onDestroy(() => {
    requestId++
    unsubscribe?.()
  })
</script>

<NavLink app={app.alias} shrink={0} disabled={app._id === active}>
  <AppItem
    selected={app._id === active}
    icon={app.icon}
    label={app.label}
    navigator={app._id === active && $deviceInfo.navigator.visible}
    notify={notificationState.notify}
    {...customProps}
    dataId={`app-sidebar-${app.alias}`}
    on:click
  />
</NavLink>
