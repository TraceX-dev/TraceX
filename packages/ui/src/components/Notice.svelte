<!--
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
  import type { IntlString } from '@hcengineering/platform'
  import type { AnySvelteComponent } from '../types'
  import Label from './Label.svelte'
  import IconCheckCircle from './icons/CheckCircle.svelte'
  import IconError from './icons/Error.svelte'
  import IconInfo from './icons/Info.svelte'

  type NoticeKind = 'positive' | 'info' | 'warning' | 'error'

  export let label: IntlString
  export let params: Record<string, any> = {}
  export let kind: NoticeKind = 'info'
  export let icon: AnySvelteComponent | undefined = undefined
  export let iconSize: 'small' | 'medium' | 'large' = 'small'

  // Reuses the same tinted label colors as tag/status pills elsewhere in the app
  const colorByKind: Record<NoticeKind, 'green' | 'blue' | 'orange' | 'red'> = {
    positive: 'green',
    info: 'blue',
    warning: 'orange',
    error: 'red'
  }

  const defaultIcons: Record<NoticeKind, AnySvelteComponent> = {
    positive: IconCheckCircle,
    info: IconInfo,
    warning: IconInfo,
    error: IconError
  }

  $: resolvedIcon = icon ?? defaultIcons[kind]
  $: color = colorByKind[kind]
</script>

<div
  class="notice"
  style:color="var(--theme-label-{color}-color)"
  style:background-color="var(--theme-label-{color}-bg-color)"
  style:border-color="var(--theme-label-{color}-border-color)"
>
  <svelte:component this={resolvedIcon} size={iconSize} />
  <span class="overflow-label"><Label {label} {params} /></span>
</div>

<style lang="scss">
  .notice {
    display: flex;
    align-items: center;
    gap: var(--spacing-1);
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    border: 1px solid;
    font-size: 0.8125rem;
    font-weight: 500;
  }
</style>
