<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
  import { getCurrentAccount } from '@hcengineering/core'
  import setting from '@hcengineering/setting'
  import { Breadcrumb, Header, Label, Loading, Scroller, showPopup } from '@hcengineering/ui'
  import { onMount } from 'svelte'

  import ChangePasswordPopup from './security/ChangePasswordPopup.svelte'
  import TwoFactorSetupPopup from './security/TwoFactorSetupPopup.svelte'
  import SettingsCard from './settings-card/SettingsCard.svelte'
  import SettingsCardsLayout from './settings-card/SettingsCardsLayout.svelte'
  import SettingsFooterAction from './settings-card/SettingsFooterAction.svelte'
  import { getAccountClient } from '../utils'

  let tfaEnabled: boolean | undefined = undefined
  let isLoading = true

  const acc = getCurrentAccount()

  async function loadTwoFactorState (): Promise<void> {
    isLoading = true
    try {
      const account = await getAccountClient().getAccountInfo(acc.uuid)
      tfaEnabled = account.tfaEnabled
    } finally {
      isLoading = false
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

  function openChangePassword (): void {
    showPopup(ChangePasswordPopup, {}, 'top')
  }

  onMount(() => {
    void loadTwoFactorState()
  })
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={setting.icon.Password} label={setting.string.Authentication} size="large" isCurrent />
  </Header>

  <div class="hulyComponent-content__column content">
    <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
      <div class="hulyComponent-content security-content">
        <SettingsCardsLayout columns={2}>
          <div class="security-column">
            <SettingsCard label={setting.string.ChangePassword}>
              <div class="simple-card">
                <Label label={setting.string.ChangePasswordDescription} />
              </div>
              <SettingsFooterAction
                slot="footer"
                label={setting.string.ChangePassword}
                color="primary"
                on:click={openChangePassword}
              />
            </SettingsCard>
          </div>

          <div class="security-column">
            <SettingsCard label={setting.string.TwoFactorAuth}>
              <div class="simple-card">
                <Label label={setting.string.TwoFactorAuthDescription} />

                {#if isLoading || tfaEnabled === undefined}
                  <Loading />
                {:else}
                  <Label
                    label={tfaEnabled ? setting.string.TwoFactorAuthEnabled : setting.string.TwoFactorAuthDisabled}
                  />
                {/if}
              </div>
              <SettingsFooterAction
                slot="footer"
                label={tfaEnabled ? setting.string.DisableTwoFactorAuth : setting.string.EnableTwoFactorAuth}
                color={tfaEnabled ? 'dangerous' : 'primary'}
                disabled={isLoading || tfaEnabled === undefined}
                on:click={openTwoFactorSetup}
              />
            </SettingsCard>
          </div>
        </SettingsCardsLayout>
      </div>
    </Scroller>
  </div>
</div>

<style lang="scss">
  .security-content {
    width: 100%;
  }

  .security-column,
  .simple-card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }
</style>
