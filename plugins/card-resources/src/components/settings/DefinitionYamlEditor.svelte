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
//
-->
<script lang="ts">
  import {
    compileProcessYaml,
    validateProcessYaml,
    validateAuthoringModelOperations,
    type AuthoringValidation,
    ProcessAuthoringError
  } from '@hcengineering/process'
  import { getClient } from '@hcengineering/presentation'
  import { Button, Dialog, Label, TextArea } from '@hcengineering/ui'
  import { createEventDispatcher, tick } from 'svelte'
  import { downloadDefinition } from '../../authoring-utils'
  import card from '../../plugin'

  export let kind: 'card' | 'process'
  export let source: string | undefined
  export let name: string = 'definition'
  export let onApply: (source: string) => Promise<boolean>
  export let onSave: ((source: string) => Promise<boolean>) | undefined = undefined

  const dispatch = createEventDispatcher()
  let busy = false
  let applyError = ''
  let validatedSource: string | undefined
  $: validation = validate(source ?? '')
  $: if (validatedSource !== source) {
    validatedSource = source
    applyError = ''
  }

  function validate (draft: string): AuthoringValidation {
    const result = validateProcessYaml(draft, kind, getClient().getModel())
    if (!result.valid) return result
    try {
      const compiled = compileProcessYaml(draft, getClient().getModel())
      if (compiled.version === 2) {
        const client = getClient()
        validateAuthoringModelOperations(compiled.docs, client.getModel(), client.getHierarchy())
      }
      return result
    } catch (error) {
      return {
        valid: false,
        diagnostic: {
          path: error instanceof ProcessAuthoringError ? error.path : '$',
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }

  async function apply (saveCurrent: boolean): Promise<void> {
    const draft = source ?? ''
    if (busy || !validate(draft).valid) return
    const action = saveCurrent ? onSave : onApply
    if (action === undefined) return
    busy = true
    applyError = ''
    try {
      if (await action(draft)) dispatch('close')
    } catch (error) {
      applyError = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
    }
  }

  function openFile (): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.yaml,.yml'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (file === undefined) return
      try {
        source = await file.text()
        name = file.name.replace(/\.ya?ml$/i, '')
      } catch (error) {
        applyError = error instanceof Error ? error.message : String(error)
      }
    }
    input.click()
  }

  async function handleKeydown (event: KeyboardEvent): Promise<void> {
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
    const input = event.target
    if (!(input instanceof HTMLTextAreaElement)) return
    event.preventDefault()
    const position = input.selectionStart
    source = (source ?? '').slice(0, position) + '  ' + (source ?? '').slice(input.selectionEnd)
    await tick()
    input.setSelectionRange(position + 2, position + 2)
  }
</script>

<Dialog
  label={card.string.YamlEditor}
  on:close={() => {
    if (!busy) dispatch('close')
  }}
>
  <div class="editor">
    <div class="flex-between">
      <Button label={card.string.YamlOpenFile} disabled={busy} on:click={openFile} />
      <span role="status" aria-live="polite">
        {#if validation.valid}<Label label={card.string.YamlValid} />{/if}
      </span>
    </div>
    <div class="source">
      <TextArea
        bind:value={source}
        label={card.string.YamlSource}
        placeholder={card.string.YamlSource}
        width="100%"
        height="55vh"
        disabled={busy}
        on:keydown={handleKeydown}
      />
    </div>
    {#if !validation.valid && validation.diagnostic}
      <pre role="alert">{validation.diagnostic.message}</pre>
    {/if}
    {#if applyError}<pre role="alert">{applyError}</pre>{/if}
  </div>
  <svelte:fragment slot="footerRight">
    <Button
      label={card.string.YamlDownload}
      disabled={busy || !source}
      on:click={() => downloadDefinition(source ?? '', name, 'yaml')}
    />
    {#if onSave}
      <Button label={card.string.YamlSaveCurrent} disabled={busy || !validation.valid} on:click={() => apply(true)} />
    {/if}
    <Button
      label={card.string.YamlCreateNew}
      kind="primary"
      disabled={busy || !validation.valid}
      on:click={() => apply(false)}
    />
  </svelte:fragment>
</Dialog>

<style lang="scss">
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2);
    width: min(60rem, 80vw);
  }

  .source {
    font-family: monospace;
    font-size: 0.875rem;
  }

  pre {
    margin: 0;
    max-height: 8rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--theme-content-color);
  }
</style>
