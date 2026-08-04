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
  export let columns = '1fr'
  export let minWidth = '0'
  export let variant: 'grid' | 'minimal' | 'cards' = 'grid'
  export let stickyHeader = true
</script>

<div
  class="uiDataTable"
  class:uiDataTable-grid={variant === 'grid'}
  class:uiDataTable-minimal={variant === 'minimal'}
  class:uiDataTable-cards={variant === 'cards'}
  style:--ui-data-table-columns={columns}
  style:--ui-data-table-min-width={minWidth}
>
  <div class:uiDataTable-stickyHeader={stickyHeader} class="uiDataTable-header">
    <slot name="header" />
  </div>
  <div class="uiDataTable-body">
    <slot />
  </div>
</div>

<style lang="scss">
  .uiDataTable {
    min-width: var(--ui-data-table-min-width);
  }

  .uiDataTable-header,
  .uiDataTable :global(.uiDataTable-row) {
    display: grid;
    grid-template-columns: var(--ui-data-table-columns);
    gap: var(--spacing-3);
    align-items: center;
  }

  .uiDataTable-header {
    z-index: 1;
    padding: var(--spacing-2) var(--spacing-4);
    color: var(--theme-caption-color);
    font-size: 0.6875rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .uiDataTable-stickyHeader {
    position: sticky;
    top: 0;
  }

  .uiDataTable :global(.uiDataTable-row) {
    width: 100%;
    min-height: 2.75rem;
    padding: var(--spacing-2) var(--spacing-4);
    border: 0;
    color: var(--theme-content-color);
    text-align: left;
  }

  .uiDataTable-grid {
    overflow: hidden;
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--border-radius-large);
  }

  .uiDataTable-grid .uiDataTable-header {
    background: var(--theme-table-header-color);
    border-bottom: 1px solid var(--theme-divider-color);
  }

  .uiDataTable-grid .uiDataTable-body {
    background: var(--theme-popup-color);
  }

  .uiDataTable-grid :global(.uiDataTable-row + .uiDataTable-row),
  .uiDataTable-minimal :global(.uiDataTable-row + .uiDataTable-row) {
    border-top: 1px solid var(--theme-divider-color);
  }

  .uiDataTable-grid :global(.uiDataTable-row:hover),
  .uiDataTable-minimal :global(.uiDataTable-row:hover) {
    background: var(--theme-button-hovered);
  }

  .uiDataTable-minimal .uiDataTable-header {
    padding-right: var(--spacing-1);
    padding-left: var(--spacing-1);
    border-bottom: 1px solid var(--theme-divider-color);
  }

  .uiDataTable-minimal :global(.uiDataTable-row) {
    padding-right: var(--spacing-1);
    padding-left: var(--spacing-1);
  }

  .uiDataTable-cards .uiDataTable-body {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2);
  }

  .uiDataTable-cards :global(.uiDataTable-row) {
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--border-radius-large);
    background: var(--theme-popup-color);
  }

  .uiDataTable-cards :global(.uiDataTable-row:hover) {
    background: var(--theme-button-hovered);
  }
</style>
