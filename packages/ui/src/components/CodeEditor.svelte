<!--
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { generateId } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import { afterUpdate } from 'svelte'
  import { resizeObserver } from '../resize'
  import Html from './Html.svelte'
  import Label from './Label.svelte'

  export let value: string | undefined = undefined
  export let label: IntlString
  export let disabled = false
  export let dataId: string | undefined = undefined
  export let highlight: ((source: string) => string) | undefined = undefined

  const id = generateId()
  const TRAILING_LINE = '\n'
  let input: HTMLTextAreaElement | undefined
  let preview: HTMLPreElement | undefined
  let highlighted: string | undefined

  $: {
    try {
      highlighted = highlight?.(value ?? '')
    } catch {
      highlighted = undefined
    }
  }

  /** Focus the native input without replacing its selection or editing history. */
  export function focus (): void {
    input?.focus()
  }

  function syncPreview (): void {
    if (input === undefined || preview === undefined) return
    preview.style.width = `${input.clientWidth}px`
    preview.style.height = `${input.clientHeight}px`
    preview.scrollTop = input.scrollTop
    preview.scrollLeft = input.scrollLeft
  }

  afterUpdate(syncPreview)
</script>

<div class="flex-col flex-gap-1 w-full h-full">
  <label for={id} class="text-sm flex-no-shrink"><Label {label} /></label>
  <div class="editor flex-grow min-h-0" class:disabled use:resizeObserver={syncPreview}>
    <pre bind:this={preview} aria-hidden="true">{#if highlighted === undefined}{value ?? ''}{:else}<Html
          value={highlighted}
        />{/if}{TRAILING_LINE}</pre>
    <textarea
      {id}
      data-id={dataId}
      bind:this={input}
      bind:value
      {disabled}
      wrap="off"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      on:scroll={syncPreview}
      on:input
      on:keydown
      on:change
      on:blur
    />
  </div>
</div>

<style>
  .editor {
    position: relative;
    border: 1px solid var(--theme-refinput-border);
    border-radius: var(--small-BorderRadius);
    overflow: hidden;
    background: var(--theme-button-default);
    color: var(--theme-content-color);
    font-family: var(--mono-font);
    font-size: 0.875rem;
    line-height: 1.5;
    tab-size: 2;
  }

  .editor:focus-within {
    border-color: var(--primary-button-default);
  }

  .disabled {
    opacity: 0.6;
  }

  pre,
  textarea {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: var(--spacing-2);
    border: 0;
    font: inherit;
    letter-spacing: inherit;
    white-space: pre;
    overflow-wrap: normal;
    word-break: normal;
  }

  pre {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    user-select: none;
  }

  textarea {
    position: relative;
    display: block;
    resize: none;
    outline: none;
    background: transparent;
    color: transparent;
    caret-color: var(--theme-content-color);
    -webkit-text-fill-color: transparent;
  }

  @media (forced-colors: active) {
    pre {
      display: none;
    }

    textarea {
      color: CanvasText;
      -webkit-text-fill-color: CanvasText;
    }
  }
</style>
