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
  import Label from './Label.svelte'

  export let label: IntlString
  export let labelText: string | undefined = undefined
  export let contentClass: string = ''
</script>

<section class="settings-card">
  <div class="settings-card__header">
    <h2>
      {#if labelText !== undefined}
        {labelText}
      {:else}
        <Label {label} />
      {/if}
    </h2>
    {#if $$slots.actions}
      <div class="settings-card__actions"><slot name="actions" /></div>
    {/if}
  </div>
  <div class="settings-card__content {contentClass}"><slot /></div>
  {#if $$slots.footer}
    <div class="settings-card__footer"><slot name="footer" /></div>
  {/if}
</section>

<style lang="scss">
  .settings-card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    color: var(--theme-content-color);
    background-color: var(--theme-popup-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    box-shadow: 0 0.125rem 0.375rem rgb(0 0 0 / 6%);
    overflow: hidden;
  }
  .settings-card__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.25rem 1.25rem 0;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.5rem;
    letter-spacing: 0;
  }
  .settings-card__actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .settings-card__content {
    min-width: 0;
    padding: 1.25rem;
  }
  .settings-card__footer {
    display: flex;
    align-items: stretch;
    min-height: 3.25rem;
    border-top: 1px solid var(--theme-divider-color);
  }
</style>
