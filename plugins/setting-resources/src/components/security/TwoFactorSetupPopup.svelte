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
  import { OK, getEmbeddedLabel, unknownError } from '@hcengineering/platform'
  import presentation, { Card } from '@hcengineering/presentation'
  import { Button, EditBox, Label, Status } from '@hcengineering/ui'
  import QRCode from 'qrcode'
  import { createEventDispatcher, onMount } from 'svelte'

  import setting from '../../plugin'
  import { getAccountClient } from '../../utils'

  export let enabled: boolean

  const dispatch = createEventDispatcher()

  let secret = ''
  let otpauthUrl = ''
  let qrCodeUrl = ''
  let code = ''
  let status = OK
  let isLoading = false

  $: canSave = code.length === 6 && !isLoading && (enabled || secret !== '')

  async function generateSecret(): Promise<void> {
    isLoading = true
    try {
      const result = await getAccountClient().generate2faSecret()
      secret = result.secret
      otpauthUrl = result.url
      status = OK
    } catch (err: any) {
      status = err.status ?? unknownError(err)
    } finally {
      isLoading = false
    }
  }

  async function verifyAndEnable(): Promise<void> {
    isLoading = true
    try {
      await getAccountClient().enable2fa(secret, code)
      dispatch('close', true)
    } catch (err: any) {
      status = err.status ?? unknownError(err)
    } finally {
      isLoading = false
    }
  }

  async function verifyAndDisable(): Promise<void> {
    isLoading = true
    try {
      await getAccountClient().disable2fa(code)
      dispatch('close', false)
    } catch (err: any) {
      status = err.status ?? unknownError(err)
    } finally {
      isLoading = false
    }
  }

  async function submit(): Promise<void> {
    if (enabled) {
      await verifyAndDisable()
    } else {
      await verifyAndEnable()
    }
  }

  $: if (otpauthUrl !== '') {
    QRCode.toDataURL(otpauthUrl, { margin: 1, width: 200 }).then((url) => {
      qrCodeUrl = url
    })
  }

  onMount(() => {
    if (!enabled) {
      void generateSecret()
    }
  })
</script>

<Card
  label={enabled ? setting.string.DisableTwoFactorAuth : setting.string.EnableTwoFactorAuth}
  width={'medium'}
  okAction={() => {}}
  okLabel={presentation.string.Save}
  {canSave}
  on:close
  onCancel={() => dispatch('close', undefined)}
>
  <div class="setup-content">
    <Label label={setting.string.TwoFactorAuthDescription} />

    {#if !enabled}
      <div class="qr-block">
        <div class="qr-code">
          {#if qrCodeUrl !== ''}
            <img src={qrCodeUrl} alt="2FA QR Code" width="200" height="200" />
          {/if}
        </div>
        <div class="secret">
          {secret}
        </div>
      </div>
    {/if}

    <div class="code-row">
      <Label label={setting.string.EnterVerificationCode} />
      <EditBox
        bind:value={code}
        kind={'default-large'}
        maxWidth={'80px'}
        placeholder={getEmbeddedLabel('000000')}
        autoFocus
      />
    </div>
  </div>

  <svelte:fragment slot="after-buttons" let:focusIndex let:canSave let:okLabel>
    <Button
      loading={isLoading}
      {focusIndex}
      minWidth={'5rem'}
      disabled={!canSave}
      label={okLabel}
      kind={'primary'}
      size={'large'}
      on:click={() => {
        void submit()
      }}
    />
  </svelte:fragment>

  <svelte:fragment slot="error">
    <Status {status} />
  </svelte:fragment>
</Card>

<style lang="scss">
  .setup-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }

  .qr-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .qr-code {
    width: 200px;
    height: 200px;
  }

  .secret {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-family: monospace;
  }

  .code-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
</style>
