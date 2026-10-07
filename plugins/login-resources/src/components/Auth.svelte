<!--
//
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
  import { onMount } from 'svelte'
  import { getCurrentLocation, Label, Loading, TimeLeft } from '@hcengineering/ui'
  import { logIn } from '@hcengineering/workbench'
  import { trackOAuthCompletion } from '@hcengineering/analytics-providers'
  import { type LoginInfoRequest, type LoginInfoByToken } from '@hcengineering/account-client'
  import platform, { OK, PlatformError, Status, unknownError } from '@hcengineering/platform'

  import type { Field } from '../types'
  import {
    afterConfirm,
    getLoginInfoFromQuery,
    getAutoJoinInfo,
    goTo,
    isWorkspaceLoginInfo,
    navigateToPublicForm,
    navigateToWorkspace,
    isLoginInfoRequest
  } from '../utils'
  import Form from './Form.svelte'
  import login from '../plugin'

  let request: LoginInfoRequest | undefined
  let fields: Field[]
  let status: Status = OK
  $: fields =
    request != null
      ? [
          { id: 'first_name', name: 'firstName', i18n: login.string.FirstName },
          { id: 'last_name', name: 'lastName', i18n: login.string.LastName, optional: true }
        ]
      : []
  const formData = {
    firstName: '' as string,
    lastName: '' as string
  }

  onMount(async () => {
    const autoJoinInfo = getAutoJoinInfo()
    if (autoJoinInfo != null) {
      goTo('autoJoin')
      return
    }

    let result: LoginInfoByToken | null = null

    try {
      result = await getLoginInfoFromQuery()
    } catch (err: any) {
      if (
        err instanceof PlatformError &&
        [platform.status.TokenExpired, platform.status.TokenNotActive].includes(err.status.code)
      ) {
        status = err.status
        return
      }
    }

    trackOAuthCompletion(result)
    await handleLoginInfo(result)
  })

  async function handleLoginInfo (result: LoginInfoByToken): Promise<void> {
    if (result == null) {
      goTo('login', true)
    } else if (isLoginInfoRequest(result)) {
      request = result
    } else {
      await logIn(result)

      if (navigateToPublicForm(getCurrentLocation().query?.navigateUrl, true)) return

      if (isWorkspaceLoginInfo(result)) {
        navigateToWorkspace(result.workspaceUrl, result, getCurrentLocation().query?.navigateUrl, true)
        return
      }

      await afterConfirm(true)
    }
  }

  const action = {
    i18n: login.string.Proceed,
    func: async () => {
      try {
        const result = await getLoginInfoFromQuery(formData)
        await handleLoginInfo(result)
      } catch (err: any) {
        if (err instanceof PlatformError) {
          status = err.status
        } else {
          status = unknownError(err)
        }
      }
    }
  }

  let timer: TimeLeft | undefined
</script>

{#if status?.code === platform.status.TokenExpired}
  <span class="text ml-8">
    <Label label={login.string.AccessExpired} />
  </span>
{:else if status?.code === platform.status.TokenNotActive}
  <span class="text ml-8">
    <Label label={login.string.AccessNotActive} />
    <TimeLeft
      bind:this={timer}
      time={status.params.notBefore * 1000}
      showHours={true}
      on:timeout={() => {
        console.log('reload due to token inactive')
        window.location.reload()
      }}
    />
  </span>
{:else if request != null}
  <Form caption={login.string.WhatIsYourName} {status} {fields} object={formData} {action} ignoreInitialValidation />
{:else}
  <Loading />
{/if}

<style>
  .text {
    color: var(--theme-caption-color);
  }
</style>
