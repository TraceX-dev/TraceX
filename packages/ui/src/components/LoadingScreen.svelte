<!--
// Copyright © 2026 TraceX SAS
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
  import { translateCB } from '@hcengineering/platform'
  import { themeStore } from '@hcengineering/theme'

  import uiPlugin from '../plugin'
  import TraceXLogo from './TraceXLogo.svelte'

  // Caption under the logo. Defaults to "Loading your workspace...".
  export let caption: IntlString = uiPlugin.string.LoadingWorkspace
  export let captionParams: Record<string, any> = {}
  // 0..100 for a determinate bar, undefined for an indeterminate one.
  export let progress: number | undefined = undefined
  // Fill the parent instead of the whole viewport area.
  export let shrink: boolean = false

  let captionText: string | undefined

  // Rendered only once translated: the loading screen appears before the
  // language bundles resolve, and a raw IntlString id must never be shown.
  $: translateCB(caption, captionParams ?? {}, $themeStore.language, (r) => {
    captionText = r
  })

  $: determinate = progress !== undefined && progress >= 0
  $: clamped = Math.max(0, Math.min(100, progress ?? 0))
</script>

<div class="tracex-loading" class:fullSize={!shrink}>
  <div class="tracex-loading__content">
    <TraceXLogo height={'2.25rem'} />

    <div class="tracex-loading__caption">
      {#if captionText !== undefined}{captionText}{:else}&nbsp;{/if}
    </div>

    <div class="tracex-loading__bar" class:determinate>
      <div class="tracex-loading__bar-fill" style:width={determinate ? `${clamped}%` : null} />
    </div>

    <div class="tracex-loading__extra">
      <slot />
    </div>
  </div>

  <div class="tracex-loading__actions">
    <slot name="actions" />
  </div>
</div>

<style lang="scss">
  .tracex-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    background-color: var(--theme-bg-color);

    &.fullSize {
      width: 100%;
      height: 100%;
    }
  }

  .tracex-loading__content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.125rem;
    animation: tracexLoadingFadeIn 0.4s ease-out both;
  }

  .tracex-loading__caption {
    font-size: 0.875rem;
    line-height: 1.25rem;
    color: var(--theme-dark-color);
    text-align: center;
    max-width: 22rem;
  }

  .tracex-loading__bar {
    position: relative;
    width: 13.75rem;
    height: 0.1875rem;
    border-radius: 0.125rem;
    background-color: var(--theme-button-border);
    overflow: hidden;
  }

  .tracex-loading__bar-fill {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 35%;
    border-radius: 0.125rem;
    background-color: var(--primary-button-default);
    animation: tracexLoadingIndeterminate 1.4s ease-in-out infinite;
  }

  .tracex-loading__bar.determinate .tracex-loading__bar-fill {
    animation: none;
    transition: width 0.3s ease-out;
  }

  .tracex-loading__extra {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8125rem;
    color: var(--theme-darker-color);
    text-align: center;
  }

  .tracex-loading__extra:empty {
    display: none;
  }

  .tracex-loading__actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .tracex-loading__actions:empty {
    display: none;
  }

  @keyframes tracexLoadingIndeterminate {
    0% {
      transform: translateX(-60%);
    }
    100% {
      transform: translateX(220%);
    }
  }

  @keyframes tracexLoadingFadeIn {
    from {
      opacity: 0;
      transform: translateY(0.25rem);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tracex-loading__content {
      animation: none;
    }

    .tracex-loading__bar-fill {
      animation-duration: 3s;
    }
  }
</style>
