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
  import { Analytics } from '@hcengineering/analytics'
  import login from '@hcengineering/login'
  import platform, { getResource, PlatformError } from '@hcengineering/platform'
  import presentation, { Card } from '@hcengineering/presentation'
  import { Button, EditBox, Icon, Label, Loading } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'

  import setting from '../../plugin'
  import Error from '../icons/Error.svelte'

  const dispatch = createEventDispatcher()

  let oldPassword: string = ''
  let password: string = ''
  let password2: string = ''
  let saved = false
  let error = false
  let hasPassword: boolean | undefined = undefined
  let checking = true
  let noEmailLinked = false
  let setupLinkSent = false
  let sendingLink = false

  $: canSave =
    !checking &&
    hasPassword !== false &&
    password.length > 0 &&
    oldPassword.length > 0 &&
    oldPassword !== password &&
    password === password2 &&
    !saved

  async function checkPassword(): Promise<void> {
    try {
      const check = await getResource(login.function.CheckHasPassword)
      hasPassword = await check()
    } catch {
      hasPassword = true
    } finally {
      checking = false
    }
  }

  async function save(): Promise<void> {
    saved = true
    try {
      const changePassword = await getResource(login.function.ChangePassword)
      await changePassword(oldPassword, password)
      dispatch('close', true)
    } catch (e: any) {
      Analytics.handleError(e)
      saved = false
      error = true
    }
  }

  async function sendSetupLink(): Promise<void> {
    sendingLink = true
    noEmailLinked = false
    try {
      const requestSetup = await getResource(login.function.RequestPasswordSetup)
      await requestSetup()
      setupLinkSent = true
    } catch (e: any) {
      if (e instanceof PlatformError && e.status.code === platform.status.SocialIdNotFound) {
        noEmailLinked = true
      } else {
        Analytics.handleError(e)
        error = true
      }
    } finally {
      sendingLink = false
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function updateSaved(p1: string, p2: string, p3: string): void {
    saved = false
    error = false
  }
  $: updateSaved(oldPassword, password, password2)

  onMount(() => {
    void checkPassword()
  })
</script>

<Card
  label={hasPassword === false ? login.string.SetPassword : login.string.ChangePassword}
  width={'medium'}
  okAction={() => {}}
  okLabel={presentation.string.Save}
  {canSave}
  on:close
  onCancel={() => dispatch('close', undefined)}
>
  {#if checking}
    <Loading />
  {:else if hasPassword === false}
    <div class="popup-content">
      {#if noEmailLinked}
        <p class="sso-hint">
          <Label label={login.string.SSONoEmailLinked} />
        </p>
      {:else if setupLinkSent}
        <p class="sso-hint">
          <Label label={login.string.SSOPasswordEmailSent} />
        </p>
      {:else}
        <p class="sso-hint">
          <Label label={login.string.SSOPasswordDescription} />
        </p>
      {/if}
    </div>
  {:else}
    <div class="popup-content">
      <div class="fields">
        <EditBox
          format="password"
          placeholder={login.string.EnterCurrentPassword}
          label={login.string.CurrentPassword}
          kind={'default'}
          bind:value={oldPassword}
          autoFocus
        />
        <EditBox
          format="password"
          placeholder={login.string.EnterNewPassword}
          label={login.string.NewPassword}
          kind={'default'}
          bind:value={password}
        />
        <EditBox
          format="password"
          placeholder={login.string.RepeatNewPassword}
          label={login.string.RepeatNewPassword}
          kind={'default'}
          bind:value={password2}
        />
      </div>
    </div>
  {/if}

  <svelte:fragment slot="after-buttons" let:focusIndex let:canSave let:okLabel>
    {#if hasPassword === false}
      <Button
        label={login.string.SendSetupLink}
        disabled={sendingLink || noEmailLinked || setupLinkSent}
        kind={'primary'}
        size={'large'}
        on:click={() => {
          void sendSetupLink()
        }}
      />
    {:else}
      <Button
        loading={saved}
        {focusIndex}
        minWidth={'5rem'}
        disabled={!canSave}
        label={okLabel}
        kind={'primary'}
        size={'large'}
        on:click={() => {
          void save()
        }}
      />
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="error">
    {#if error}
      <div class="footer-error">
        <Icon icon={Error} size={'small'} />
        <Label label={setting.string.FailedToSave} />
      </div>
    {/if}
  </svelte:fragment>
</Card>

<style lang="scss">
  .popup-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }

  .footer-error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    color: var(--theme-error-color);
    font-size: 0.8125rem;
  }

  .sso-hint {
    margin: 0;
    color: var(--theme-dark-color);
    font-size: 0.8125rem;
    line-height: 1.5;
  }
</style>
