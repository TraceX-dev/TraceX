<script lang="ts">
  import core, { getCurrentAccount } from '@hcengineering/core'
  import { DevicesPreference } from '@hcengineering/love'
  import { getClient, SettingsCard, SettingsCardsLayout } from '@hcengineering/presentation'
  import { Breadcrumb, Header, Label, Scroller, Toggle } from '@hcengineering/ui'
  import love from '../plugin'
  import { myPreferences } from '../stores'
  import { liveKitClient } from '../utils'

  const client = getClient()

  async function saveMicPreference (myPreferences: DevicesPreference | undefined, value: boolean): Promise<void> {
    if (myPreferences !== undefined) {
      await client.update(myPreferences, { micEnabled: !value })
    } else {
      const acc = getCurrentAccount().uuid
      await client.createDoc(love.class.DevicesPreference, core.space.Workspace, {
        attachedTo: acc,
        noiseCancellation: true,
        micEnabled: !value,
        camEnabled: true,
        blurRadius: 0
      })
    }
  }

  async function saveCamPreference (myPreferences: DevicesPreference | undefined, value: boolean): Promise<void> {
    if (myPreferences !== undefined) {
      await client.update(myPreferences, { camEnabled: !value })
    } else {
      const acc = getCurrentAccount().uuid
      await client.createDoc(love.class.DevicesPreference, core.space.Workspace, {
        attachedTo: acc,
        noiseCancellation: true,
        camEnabled: !value,
        micEnabled: true,
        blurRadius: 0
      })
    }
  }

  async function saveNoiseCancellationPreference (
    myPreferences: DevicesPreference | undefined,
    value: boolean
  ): Promise<void> {
    if (myPreferences !== undefined) {
      await client.update(myPreferences, { noiseCancellation: value })
    } else {
      const acc = getCurrentAccount().uuid
      await client.createDoc(love.class.DevicesPreference, core.space.Workspace, {
        attachedTo: acc,
        noiseCancellation: value,
        camEnabled: true,
        micEnabled: true,
        blurRadius: 0
      })
    }
    await liveKitClient.applyNoiseCancellation(value)
  }

  async function saveSpeakingWhileMutedPreference (
    myPreferences: DevicesPreference | undefined,
    value: boolean
  ): Promise<void> {
    if (myPreferences !== undefined) {
      await client.update(myPreferences, { speakingWhileMutedAlert: value })
    } else {
      const acc = getCurrentAccount().uuid
      await client.createDoc(love.class.DevicesPreference, core.space.Workspace, {
        attachedTo: acc,
        noiseCancellation: true,
        camEnabled: true,
        micEnabled: true,
        blurRadius: 0,
        speakingWhileMutedAlert: value
      })
    }
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={love.icon.Love} label={love.string.Settings} size={'large'} isCurrent />
  </Header>
  <div class="hulyComponent-content__column content">
    <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
      <div class="hulyComponent-content w-full">
        <SettingsCardsLayout columns={1}>
          <SettingsCard label={love.string.Settings}>
            <div class="flex-col flex-gap-4">
              <div class="flex-between flex-gap-4">
                <Label label={love.string.StartWithMutedMic} />
                <Toggle
                  on={!($myPreferences?.micEnabled ?? true)}
                  on:change={(e) => {
                    void saveMicPreference($myPreferences, e.detail)
                  }}
                />
              </div>
              <div class="flex-between flex-gap-4">
                <Label label={love.string.StartWithoutVideo} />
                <Toggle
                  on={!($myPreferences?.camEnabled ?? true)}
                  on:change={(e) => {
                    void saveCamPreference($myPreferences, e.detail)
                  }}
                />
              </div>
              <div class="flex-between flex-gap-4">
                <Label label={love.string.NoiseCancellation} />
                <Toggle
                  on={$myPreferences?.noiseCancellation ?? true}
                  on:change={(e) => {
                    void saveNoiseCancellationPreference($myPreferences, e.detail)
                  }}
                />
              </div>
              <div class="flex-between flex-gap-4">
                <Label label={love.string.SpeakingWhileMutedAlert} />
                <Toggle
                  on={$myPreferences?.speakingWhileMutedAlert ?? true}
                  on:change={(e) => {
                    void saveSpeakingWhileMutedPreference($myPreferences, e.detail)
                  }}
                />
              </div>
            </div>
          </SettingsCard>
        </SettingsCardsLayout>
      </div>
    </Scroller>
  </div>
</div>
