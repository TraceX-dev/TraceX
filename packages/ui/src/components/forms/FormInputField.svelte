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
  /** Inline input frame for form rows: border and background appear only on hover and focus. */
  export let disabled: boolean = false
  export let multiline: boolean = false
</script>

<div class="formInputField" class:disabled class:multiline>
  <slot />
</div>

<style lang="scss">
  .formInputField {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    width: 18rem;
    max-width: 100%;
    min-height: 2.25rem;
    padding: 0 0.625rem;
    border: 1px solid transparent;
    border-radius: 0.5rem;
    background-color: transparent;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease;

    &.multiline {
      flex-grow: 1;
      width: auto;
      padding: 0.5rem 0.625rem;
    }
    &:not(.disabled):hover,
    &:not(.disabled):focus-within {
      border-color: var(--theme-button-border);
      background-color: var(--theme-button-default);
    }
    & > :global(*) {
      flex-grow: 1;
      min-width: 0;
    }
  }
</style>
