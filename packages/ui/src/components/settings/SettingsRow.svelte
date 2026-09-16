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

<div class="settingsRow" class:top={align === 'top'} aria-disabled={disabled ? 'true' : undefined} data-id={dataId}>
  <div class="settingsRow__header" class:disabled>
    <div class="settingsRow__title">
      {#if clickableLabel && controlId !== undefined}
        <label id={labelId} class="settingsRow__label clickable" class:disabled for={controlId}>
          <Label {label} params={labelParams} />
        </label>
      {:else if clickableLabel}
        <button
          id={labelId}
          class="settingsRow__label clickable labelButton"
          type="button"
          {disabled}
          on:click={handleLabelClick}
        >
          <Label {label} params={labelParams} />
        </button>
      {:else}
        <span id={labelId} class="settingsRow__label"><Label {label} params={labelParams} /></span>
      {/if}
      <slot name="badge" />
    </div>
    {#if description !== undefined || note !== undefined}
      <span id={descriptionId} class="settingsRow__description">
        {#if description !== undefined}
          <Label label={description} params={descriptionParams} />
        {/if}
        {#if note !== undefined}
          <span class="settingsRow__note"><Label label={note} params={noteParams} /></span>
        {/if}
      </span>
    {/if}
  </div>
  <div class="settingsRow__value">
    <slot />
  </div>
</div>

<style lang="scss">
  .settingsRow {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 2.25rem;

    &.top {
      align-items: flex-start;

      .settingsRow__header {
        justify-content: center;
        min-height: 2.25rem;
      }
    }
  }
  .settingsRow__header {
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
  .settingsRow__title {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
  }
  .settingsRow__label {
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
  .settingsRow__description {
    font-size: 0.75rem;
    color: var(--theme-halfcontent-color);
  }
  .settingsRow__description .settingsRow__note:not(:first-child)::before {
    content: ' ';
  }
  .settingsRow__value {
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
