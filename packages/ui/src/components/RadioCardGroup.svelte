<!--
//
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
  import { createEventDispatcher } from 'svelte'

  import type { RadioCardItem } from '../types'
  import Icon from './Icon.svelte'
  import Label from './Label.svelte'
  import ModernRadioButton from './ModernRadioButton.svelte'

  export let items: RadioCardItem[]
  export let selected: string | undefined = undefined
  export let disabled: boolean = false

  const dispatch = createEventDispatcher<{ change: string }>()

  function select (item: RadioCardItem): void {
    if (disabled || item.disabled === true || selected === item.id) return
    selected = item.id
    dispatch('change', item.id)
  }
</script>

<div class="radio-cards" role="radiogroup">
  {#each items as item (item.id)}
    <!-- The radio button handles keyboard and label clicks; this covers clicks on the card padding. -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="radio-card"
      class:selected={selected === item.id}
      class:disabled={disabled || item.disabled === true}
      on:click={() => {
        select(item)
      }}
    >
      <ModernRadioButton
        group={selected}
        value={item.id}
        disabled={disabled || item.disabled === true}
        on:change={() => {
          select(item)
        }}
      >
        <span class="radio-card__content">
          {#if item.icon !== undefined}
            <span class="radio-card__icon"><Icon icon={item.icon} size="small" /></span>
          {/if}
          <span class="radio-card__text">
            <span class="radio-card__title">
              <Label label={item.label} />
              {#if item.badge !== undefined}
                <span class="radio-card__badge {item.badgeKind ?? 'accent'}"><Label label={item.badge} /></span>
              {/if}
            </span>
            {#if item.description !== undefined}
              <span class="radio-card__description"><Label label={item.description} /></span>
            {/if}
          </span>
        </span>
      </ModernRadioButton>
    </div>
  {/each}
</div>

<style lang="scss">
  .radio-cards {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-1);
  }

  .radio-card {
    padding: var(--spacing-1_25) var(--spacing-1_5);
    border: 1px solid var(--global-ui-BorderColor);
    border-radius: var(--medium-BorderRadius);
    cursor: pointer;

    &:hover:not(.disabled) {
      background-color: var(--global-ui-hover-highlight-BackgroundColor);
    }

    &.selected {
      border-color: var(--global-accent-BackgroundColor);
      background-color: var(--global-ui-highlight-BackgroundColor);
    }

    &.disabled {
      cursor: default;
      opacity: 0.6;
    }

    :global(.radioButton-container) {
      display: flex;
      align-items: center;
      width: 100%;
    }

    :global(.radioButton-label) {
      flex: 1;
      min-width: 0;
    }
  }

  .radio-card__content {
    display: flex;
    align-items: center;
    gap: var(--spacing-1_25);
    min-width: 0;
  }

  .radio-card__icon {
    display: flex;
    flex-shrink: 0;
    color: var(--global-secondary-TextColor);
  }

  .radio-card__text {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-0_25);
    min-width: 0;
  }

  .radio-card__title {
    display: flex;
    align-items: center;
    gap: var(--spacing-1);
    color: var(--global-primary-TextColor);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .radio-card__description {
    color: var(--global-tertiary-TextColor);
    font-size: 0.75rem;
  }

  .radio-card__badge {
    padding: var(--spacing-0_25) var(--spacing-0_75);
    border-radius: 1rem;
    background-color: var(--global-ui-highlight-BackgroundColor);
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;

    &.accent {
      color: var(--global-accent-TextColor);
    }

    &.warning {
      color: var(--theme-warning-color);
    }
  }
</style>
