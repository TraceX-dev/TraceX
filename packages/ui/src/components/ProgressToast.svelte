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
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { Readable } from 'svelte/store'
  import { type Notification } from './notifications/Notification'
  import { NotificationSeverity } from './notifications/NotificationSeverity'
  import NotificationToast from './NotificationToast.svelte'
  import Spinner from './Spinner.svelte'

  interface ProgressState {
    status: 'running' | 'success' | 'error'
    title: string
    message?: string
  }

  export let notification: Notification
  export let onRemove: () => void

  const state = notification.params?.state as Readable<ProgressState>

  // The toast has no closeTimeout, so it persists until removed: auto-dismiss shortly
  // after the task reaches a terminal (success/error) state.
  let dismissTimer: ReturnType<typeof setTimeout> | undefined
  $: if ($state !== undefined && $state.status !== 'running') {
    if (dismissTimer !== undefined) {
      clearTimeout(dismissTimer)
    }
    dismissTimer = setTimeout(onRemove, 4000)
  }
  onDestroy(() => {
    if (dismissTimer !== undefined) {
      clearTimeout(dismissTimer)
    }
  })

  $: severity =
    $state?.status === 'error'
      ? NotificationSeverity.Error
      : $state?.status === 'success'
        ? NotificationSeverity.Success
        : NotificationSeverity.Info
</script>

<NotificationToast title={$state?.title ?? ''} {severity} onClose={onRemove}>
  <svelte:fragment slot="content">
    <div class="flex-row-center flex-gap-2">
      {#if $state?.status === 'running'}
        <Spinner size="small" />
      {/if}
      {#if $state?.message}
        <span class="content-color">{$state.message}</span>
      {/if}
    </div>
  </svelte:fragment>
</NotificationToast>
