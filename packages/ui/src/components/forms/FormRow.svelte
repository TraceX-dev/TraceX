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
  import type { IntlString } from '@hcengineering/platform'
  import { createEventDispatcher } from 'svelte'
  import Label from '../Label.svelte'

  export let label: IntlString
  export let labelParams: Record<string, any> = {}
  /** Second line under the label. */
  export let description: IntlString | undefined = undefined
  export let descriptionParams: Record<string, any> = {}
  /** Appended to the description, e.g. why the setting cannot be changed. */
  export let note: IntlString | undefined = undefined
  export let noteParams: Record<string, any> = {}
  export let disabled: boolean = false
  /** Clicking the label dispatches `labelClick` (used to toggle the row's control). */
  export let clickableLabel: boolean = false
  /** The id of the row's form control. Enables native label activation and accessible naming. */
  export let controlId: string | undefined = undefined
  export let align: 'center' | 'top' = 'center'
  export let dataId: string | undefined = undefined

  const dispatch = createEventDispatcher<{ labelClick: undefined }>()

  function handleLabelClick (): void {
    if (clickableLabel && !disabled) {
      dispatch('labelClick')
    }
  }

  $: labelId = controlId !== undefined ? `${controlId}-label` : undefined
  $: descriptionId = controlId !== undefined ? `${controlId}-description` : undefined
</script>

<div class="formRow" class:top={align === 'top'} aria-disabled={disabled ? 'true' : undefined} data-id={dataId}>
  <div class="formRow__header" class:disabled>
    <div class="formRow__title">
      {#if clickableLabel && controlId !== undefined}
        <label id={labelId} class="formRow__label clickable" class:disabled for={controlId}>
          <Label {label} params={labelParams} />
        </label>
      {:else if clickableLabel}
        <button
          id={labelId}
          class="formRow__label clickable labelButton"
          type="button"
          {disabled}
          on:click={handleLabelClick}
        >
          <Label {label} params={labelParams} />
        </button>
      {:else}
        <span id={labelId} class="formRow__label"><Label {label} params={labelParams} /></span>
      {/if}
      <slot name="badge" />
    </div>
    {#if description !== undefined || note !== undefined}
      <span id={descriptionId} class="formRow__description">
        {#if description !== undefined}
          <Label label={description} params={descriptionParams} />
        {/if}
        {#if note !== undefined}
          <span class="formRow__note"><Label label={note} params={noteParams} /></span>
        {/if}
      </span>
    {/if}
  </div>
  <div class="formRow__value">
    <slot />
  </div>
</div>

<style lang="scss">
  .formRow {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 2.25rem;

    &.top {
      align-items: flex-start;

      .formRow__header {
        justify-content: center;
        min-height: 2.25rem;
      }
    }
  }
  .formRow__header {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 15rem;
    min-width: 0;
    padding-right: 1rem;
    color: var(--theme-caption-color);

    &.disabled {
      color: var(--theme-darker-color);
    }
  }
  .formRow__title {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
  }
  .formRow__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: none;

    &.clickable {
      cursor: pointer;
    }

    &.disabled {
      cursor: default;
    }
  }
  .labelButton {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  .formRow__description {
    font-size: 0.75rem;
    color: var(--theme-halfcontent-color);
  }
  .formRow__description .formRow__note:not(:first-child)::before {
    content: ' ';
  }
  .formRow__value {
    display: flex;
    flex-grow: 1;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;

    // Value pickers (types, owners, members) share one minimal width and may grow with content.
    // Pickers are either a button or a button inside a thin wrapper (e.g. the members tooltip wrapper).
    & > :global(.antiButton:not(.only-icon)),
    & > :global(*) > :global(.antiButton:not(.only-icon)) {
      box-sizing: border-box;
      min-width: 8rem;
      height: 2.25rem;
    }
    & :global(.antiButton .label),
    & :global(.antiButton .overflow-label) {
      flex-shrink: 0;
      white-space: nowrap;
    }
  }
</style>
