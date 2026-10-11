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
  import Label from '../Label.svelte'

  /** Omit the label for the leading group: a "General" header carries no information. */
  export let label: IntlString | undefined = undefined
  export let labelParams: Record<string, any> = {}
  export let dataId: string | undefined = undefined
</script>

<section class="formGroup" data-id={dataId}>
  {#if label !== undefined}
    <div class="formGroup__header">
      <span class="formGroup__title"><Label {label} params={labelParams} /></span>
      <span class="formGroup__rule" />
    </div>
  {/if}
  <div class="formGroup__rows">
    <slot />
  </div>
</section>

<style lang="scss">
  .formGroup {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-width: 0;
  }
  .formGroup__header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  .formGroup__title {
    flex-shrink: 0;
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--theme-halfcontent-color);
  }
  .formGroup__rule {
    flex-grow: 1;
    height: 1px;
    background-color: var(--theme-divider-color);
  }
  .formGroup__rows {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
</style>
