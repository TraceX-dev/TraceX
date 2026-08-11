<!--
// Copyright © TraceX SAS 2026
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
  import { getCurrentAccount } from '@hcengineering/core'
  import setting from '@hcengineering/setting'
  import view from '@hcengineering/view'
  import {
    Breadcrumb,
    Button,
    defineSeparators,
    getCurrentResolvedLocation,
    Header,
    Label,
    Loading,
    navigate,
    NavItem,
    resolvedLocationStore,
    Scroller,
    Separator,
    showPopup,
    twoPanelsSeparators
  } from '@hcengineering/ui'
  import { onDestroy, onMount } from 'svelte'

  import settingsRes from '../plugin'
  import { getAccountClient } from '../utils'
  import ActiveSessionsSettings from './ActiveSessionsSettings.svelte'
  import SessionHistorySettings from './SessionHistorySettings.svelte'
  import TwoFactorSetupPopup from './security/TwoFactorSetupPopup.svelte'

  type SecurityTab = 'twoFactor' | 'loginHistory' | 'activeSessions'

  // 2FA setup UI itself now lives in TwoFactorSetupPopup.svelte (shared with AuthenticationSettings.svelte);
  // this tab only tracks/toggles the enabled state and opens that popup for the actual setup flow.
  let tfaEnabled: boolean | undefined = undefined
  let isTfaLoading = true

  const acc = getCurrentAccount()

  async function loadTwoFactorState (): Promise<void> {
    isTfaLoading = true
    try {
      const account = await getAccountClient().getAccountInfo(acc.uuid)
      tfaEnabled = account.tfaEnabled
    } finally {
      isTfaLoading = false
    }
  }

  function openTwoFactorSetup (): void {
    if (tfaEnabled === undefined) return

    showPopup(TwoFactorSetupPopup, { enabled: tfaEnabled }, 'top', (enabled?: boolean) => {
      if (enabled !== undefined) {
        tfaEnabled = enabled
      }
    })
  }

  onMount(() => {
    void loadTwoFactorState()
  })

  function tabFromPath (segment: string | undefined): SecurityTab {
    if (segment === 'activeSessions') return 'activeSessions'
    // 'sessions' kept for backward-compatible deep links to the old tab.
    if (segment === 'loginHistory' || segment === 'sessions') return 'loginHistory'
    return 'twoFactor'
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
          label={settingsRes.string.SecurityTabLoginHistory}
          selected={securityTab === 'loginHistory'}
          on:click={() => {
            selectTab('loginHistory')
          }}
        />
        <NavItem
          icon={setting.icon.Signout}
          label={settingsRes.string.SecurityTabActiveSessions}
          selected={securityTab === 'activeSessions'}
          on:click={() => {
            selectTab('activeSessions')
          }}
        />
      </Scroller>
    </div>

    <Separator name={'securitySettings'} index={0} color={'var(--theme-divider-color)'} />

    <div class="hulyComponent-content__column content">
      <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
        {#if securityTab === 'twoFactor'}
          <div class="flex-col p-6 gap-4 max-w-2xl">
            <div class="flex flex-between">
              <Label label={setting.string.TwoFactorAuthDescription} />
              {#if isTfaLoading || tfaEnabled === undefined}
                <Loading />
              {:else}
                <Button
                  label={tfaEnabled ? setting.string.DisableTwoFactorAuth : setting.string.EnableTwoFactorAuth}
                  kind={tfaEnabled ? 'negative' : 'primary'}
                  disabled={isTfaLoading || tfaEnabled === undefined}
                  on:click={openTwoFactorSetup}
                />
              {/if}
            </div>
            {#if !isTfaLoading && tfaEnabled !== undefined}
              <Label label={tfaEnabled ? setting.string.TwoFactorAuthEnabled : setting.string.TwoFactorAuthDisabled} />
            {/if}
          </div>
        {:else if securityTab === 'loginHistory'}
          <SessionHistorySettings />
        {:else}
          <ActiveSessionsSettings />
        {/if}
      </Scroller>
    </div>
  </div>
</div>
