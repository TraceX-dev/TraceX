<!--

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
-->
<script lang="ts">
  import { type Class, type Doc, type Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { Icon, IconClose, IconMoreH, Label, showPopup, tooltip } from '@hcengineering/ui'
  import { type Action as ViewAction } from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'
  import { getActions, invokeAction } from '../actions'
  import Menu from './Menu.svelte'
  import view from '../plugin'

  export let docs: Doc[] = []
  export let baseMenuClass: Ref<Class<Doc>> | undefined = undefined
  // When the table also renders its own sticky footer, lift the bar above it so they don't overlap.
  export let liftForFooter: boolean = false

  // How many actions to expose directly as buttons before collapsing the rest behind "More".
  const QUICK_ACTIONS_LIMIT = 2

  const client = getClient()
  const dispatch = createEventDispatcher()

  let actions: ViewAction[] = []
  let loadToken = 0

  $: void loadActions(docs, baseMenuClass)

  async function loadActions (docs: Doc[], baseMenuClass: Ref<Class<Doc>> | undefined): Promise<void> {
    const token = ++loadToken
    if (docs.length === 0) {
      actions = []
      return
    }
    const result = await getActions(client, docs, baseMenuClass, 'context')
    if (token === loadToken) {
      actions = result
    }
  }

  $: removeAction = actions.find((a) => a.context.group === 'remove')
  $: otherActions = actions.filter((a) => a._id !== removeAction?._id)
  $: quickActions = otherActions.slice(0, QUICK_ACTIONS_LIMIT)
  $: overflowCount = otherActions.length - quickActions.length

  let moreButton: HTMLButtonElement

  function showMoreActions (): void {
    showPopup(Menu, { object: docs, baseMenuClass }, moreButton)
  }

  function runAction (action: ViewAction, ev: MouseEvent): void {
    void invokeAction(docs, ev, action)
  }
</script>

{#if docs.length > 0}
  <div class="table-selection-bar-anchor" class:with-footer={liftForFooter}>
    <div class="table-selection-bar">
      <span class="table-selection-bar__count">
        <Label label={view.string.SelectedCount} params={{ count: docs.length }} />
      </span>
      <div class="table-selection-bar__divider" />
      {#each quickActions as action (action._id)}
        <button
          class="table-selection-bar__action"
          on:click={(ev) => {
            runAction(action, ev)
          }}
        >
          {#if action.icon}<Icon icon={action.icon} size={'small'} />{/if}
          <Label label={action.label} />
        </button>
      {/each}
      {#if overflowCount > 0}
        <button
          class="table-selection-bar__action"
          bind:this={moreButton}
          use:tooltip={{ label: view.string.MoreActions }}
          on:click={showMoreActions}
        >
          <IconMoreH size={'small'} />
        </button>
      {/if}
      {#if removeAction}
        <div class="table-selection-bar__divider" />
        <button
          class="table-selection-bar__action table-selection-bar__action--danger"
          on:click={(ev) => {
            runAction(removeAction, ev)
          }}
        >
          {#if removeAction.icon}<Icon icon={removeAction.icon} size={'small'} />{/if}
          <Label label={removeAction.label} />
        </button>
      {/if}
      <div class="table-selection-bar__divider" />
      <button
        class="table-selection-bar__close"
        use:tooltip={{ label: view.string.ClearSelection }}
        on:click={() => {
          dispatch('clear')
        }}
      >
        <IconClose size={'small'} />
      </button>
    </div>
  </div>
{/if}

<style lang="scss">
  .table-selection-bar-anchor {
    position: sticky;
    left: 0;
    right: 0;
    bottom: 1rem;
    z-index: 5;
    display: flex;
    justify-content: center;
    width: 100%;
    pointer-events: none;

    &.with-footer {
      bottom: calc(2.5rem + 1rem);
    }
  }

  .table-selection-bar {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.375rem 0.375rem 0.875rem;
    background-color: var(--theme-popup-color);
    border: 1px solid var(--theme-popup-divider);
    border-radius: 0.625rem;
    box-shadow: var(--global-popover-ShadowX) var(--global-popover-ShadowY) var(--global-popover-ShadowBlur)
      var(--global-popover-ShadowSpread) var(--global-popover-ShadowColor);
    pointer-events: auto;
    animation: table-selection-bar-in 0.12s ease-out;
  }

  @keyframes table-selection-bar-in {
    from {
      opacity: 0;
      transform: translateY(0.5rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .table-selection-bar__count {
    flex-shrink: 0;
    padding: 0 0.375rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--theme-caption-color);
    white-space: nowrap;
  }

  .table-selection-bar__divider {
    flex-shrink: 0;
    width: 1px;
    height: 1.125rem;
    background-color: var(--theme-divider-color);
  }

  .table-selection-bar__action,
  .table-selection-bar__close {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
    height: 1.75rem;
    padding: 0 0.625rem;
    color: var(--theme-caption-color);
    background-color: transparent;
    border: none;
    border-radius: 0.375rem;
    outline: none;
    font-size: 0.8125rem;
    white-space: nowrap;
    cursor: pointer;

    &:hover {
      background-color: var(--theme-button-hovered);
    }
    &:active {
      background-color: var(--theme-button-pressed);
    }
  }

  .table-selection-bar__action--danger {
    // Same reasoning as .table-selection-bar__count above - a theme-aware error text color
    // instead of the fixed --negative-button-default fill color.
    color: var(--global-error-TextColor);

    &:hover {
      background-color: var(--theme-button-hovered);
    }
    &:active {
      background-color: var(--theme-button-pressed);
    }
  }

  .table-selection-bar__close {
    padding: 0 0.5rem;
    color: var(--theme-dark-color);
  }
</style>
