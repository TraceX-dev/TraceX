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
  import type { Asset, IntlString } from '@hcengineering/platform'
  import { Icon, Label } from '@hcengineering/ui'
  import type { AnySvelteComponent } from '@hcengineering/ui/src/types'
  import type { ComponentType } from 'svelte'

  type FooterActionColor = 'primary' | 'secondary' | 'dangerous'

  export let label: IntlString
  export let icon: Asset | AnySvelteComponent | ComponentType | undefined = undefined
  export let color: FooterActionColor = 'primary'
  export let accent: boolean = true
  export let disabled: boolean = false
  export let loading: boolean = false
</script>

<button class="settings-footer-action {color}" class:accent disabled={disabled || loading} type="button" on:click>
  {#if icon !== undefined}
    <span class="icon">
      <Icon {icon} size="small" />
    </span>
  {/if}
  <span class="label">
    <Label {label} />
  </span>
</button>

<style lang="scss">
  .settings-footer-action {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-width: 0;
    min-height: 3.25rem;
    padding: 0.75rem 1.25rem;
    color: var(--settings-footer-action-color);
    background-color: transparent;
    border: 0;
    font: inherit;
    text-align: left;
    cursor: pointer;
    outline: none;
    transition: color 0.15s ease;

    &.primary {
      --settings-footer-action-color: var(--primary-button-default);
      --settings-footer-action-hover-color: var(--primary-button-hovered);
    }

    &.secondary {
      --settings-footer-action-color: var(--theme-caption-color);
      --settings-footer-action-hover-color: var(--theme-content-color);
    }

    &.dangerous {
      --settings-footer-action-color: var(--negative-button-default);
      --settings-footer-action-hover-color: var(--negative-button-hovered);
    }

    &.accent {
      font-weight: 500;
    }

    &:not(:disabled):hover {
      color: var(--settings-footer-action-hover-color);
      background-color: var(--theme-button-hovered);
    }

    &:focus-visible {
      outline: 2px solid var(--global-focus-BorderColor);
      outline-offset: -2px;
    }

    &:disabled {
      color: var(--theme-trans-content-color);
      cursor: default;
    }
  }

  .icon {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
