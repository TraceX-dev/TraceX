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

  export type InlineBannerKind = 'positive' | 'info' | 'warning' | 'error'

  export let label: IntlString
  export let params: Record<string, any> = {}
  export let kind: InlineBannerKind = 'info'
  export let icon: AnySvelteComponent | undefined = undefined
  export let iconSize: 'small' | 'medium' | 'large' = 'small'

  const defaultIcons: Record<InlineBannerKind, AnySvelteComponent> = {
    positive: IconCheckCircle,
    info: IconInfo,
    warning: IconInfo,
    error: IconError
  }

  $: resolvedIcon = icon ?? defaultIcons[kind]
</script>

<div class="inlineBanner {kind}">
  <svelte:component this={resolvedIcon} size={iconSize} />
  <span class="overflow-label"><Label {label} {params} /></span>
</div>

<style lang="scss">
  .inlineBanner {
    display: flex;
    align-items: center;
    gap: var(--spacing-1);
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 500;

    &.positive {
      color: var(--theme-banner-positive-color);
      background-color: var(--theme-banner-positive-bg);
      border: 1px solid var(--theme-banner-positive-border);
    }
    &.info {
      color: var(--theme-banner-info-color);
      background-color: var(--theme-banner-info-bg);
      border: 1px solid var(--theme-banner-info-border);
    }
    &.warning {
      color: var(--theme-banner-warning-color);
      background-color: var(--theme-banner-warning-bg);
      border: 1px solid var(--theme-banner-warning-border);
    }
    &.error {
      color: var(--theme-banner-error-color);
      background-color: var(--theme-banner-error-bg);
      border: 1px solid var(--theme-banner-error-border);
    }
  }
</style>
