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
  import { Label, Spinner } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'

  // A placeholder for the default discussion that does not exist yet.
  export let name: string
  export let loading: boolean = false

  const dispatch = createEventDispatcher()

  function open (): void {
    if (!loading) dispatch('open')
  }

  function handleKeydown (event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }
</script>

<div class="discussion-row" role="button" tabindex="0" on:click={open} on:keydown={handleKeydown}>
  <div class="state">
    {#if loading}
      <Spinner size="small" />
    {:else}
      <span class="dot" />
    {/if}
  </div>
  <div class="content">
    <span class="title overflow-label">{name}</span>
    <div class="subtitle overflow-label">
      <Label label={chunter.string.NoMessagesInChannel} />
    </div>
  </div>
</div>

<style lang="scss">
  .discussion-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.875rem;
    border-bottom: 1px solid var(--theme-divider-color);
    cursor: pointer;

    &:last-child {
      border-bottom: none;
    }

    &:hover,
    &:focus-visible {
      background: var(--global-ui-hover-highlight-BackgroundColor);
      outline: none;
    }
  }

  .state {
    display: flex;
    align-self: flex-start;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1rem;
    height: 1.25rem;
  }

  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--global-ui-BorderColor);
  }

  .content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .title {
    color: var(--global-primary-TextColor);
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;
  }

  .subtitle {
    color: var(--global-secondary-TextColor);
    font-size: 0.75rem;
    line-height: 1.125rem;
  }
</style>
