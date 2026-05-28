<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
  import setting from '@hcengineering/setting'
  import view from '@hcengineering/view'
  import {
    Breadcrumb,
    defineSeparators,
    getCurrentResolvedLocation,
    Header,
    navigate,
    NavItem,
    resolvedLocationStore,
    Scroller,
    Separator,
    twoPanelsSeparators
  } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'

  import settingsRes from '../plugin'
  import SessionHistorySettings from './SessionHistorySettings.svelte'
  import TwoFactorSettings from './TwoFactorSettings.svelte'

  type SecurityTab = 'twoFactor' | 'sessions'

  function tabFromPath (segment: string | undefined): SecurityTab {
    return segment === 'sessions' ? 'sessions' : 'twoFactor'
  }

  let securityTab: SecurityTab = tabFromPath(getCurrentResolvedLocation().path[4])

  onDestroy(
    resolvedLocationStore.subscribe((loc) => {
      const next = tabFromPath(loc.path[4])
      if (next !== securityTab) {
        securityTab = next
      }
    })
  )

  function selectTab (tab: SecurityTab): void {
    if (securityTab === tab) return
    securityTab = tab
    const loc = getCurrentResolvedLocation()
    loc.path[4] = tab
    loc.path.length = 5
    navigate(loc)
  }

  defineSeparators('securitySettings', twoPanelsSeparators)
</script>

<div class="hulyComponent w-full">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={setting.icon.Password} label={setting.string.Security} size={'large'} isCurrent />
  </Header>
  <div class="hulyComponent-content__container columns">
    <div class="hulyComponent-content__column navigation py-2">
      <Scroller shrink>
        <NavItem
          icon={setting.icon.Password}
          label={setting.string.TwoFactorAuth}
          selected={securityTab === 'twoFactor'}
          on:click={() => {
            selectTab('twoFactor')
          }}
        />
        <NavItem
          icon={view.icon.Timeline}
          label={settingsRes.string.SecurityTabSessions}
          selected={securityTab === 'sessions'}
          on:click={() => {
            selectTab('sessions')
          }}
        />
      </Scroller>
    </div>

    <Separator name={'securitySettings'} index={0} color={'var(--theme-divider-color)'} />

    <div class="hulyComponent-content__column content">
      <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
        {#if securityTab === 'twoFactor'}
          <TwoFactorSettings />
        {:else}
          <SessionHistorySettings />
        {/if}
      </Scroller>
    </div>
  </div>
</div>
