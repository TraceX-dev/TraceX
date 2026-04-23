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
    Header,
    NavItem,
    Scroller,
    Separator,
    twoPanelsSeparators
  } from '@hcengineering/ui'

  import settingsRes from '../plugin'
  import SessionHistorySettings from './SessionHistorySettings.svelte'
  import TwoFactorSettings from './TwoFactorSettings.svelte'

  let securityTab: 'twoFactor' | 'sessions' = 'twoFactor'

  defineSeparators('securitySettings', twoPanelsSeparators)
</script>

<div class="hulyComponent">
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
            securityTab = 'twoFactor'
          }}
        />
        <NavItem
          icon={view.icon.Timeline}
          label={settingsRes.string.SecurityTabSessions}
          selected={securityTab === 'sessions'}
          on:click={() => {
            securityTab = 'sessions'
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
