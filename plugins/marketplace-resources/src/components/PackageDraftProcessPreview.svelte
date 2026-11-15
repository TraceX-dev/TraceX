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
  import { type Class, type Doc, type Ref } from '@hcengineering/core'
  import marketplace from '@hcengineering/marketplace'
  import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'
  import { getClient, MessageViewer } from '@hcengineering/presentation'
  import process, { type AuthoringNativeDocument, type Method, type State } from '@hcengineering/process'
  import { AccordionItem, Label } from '@hcengineering/ui'
  import { draftCodeMarkup, draftProcessDiagram, type DraftProcessPreview } from '../package-draft-preview'
  import PackageDraftType from './PackageDraftType.svelte'

  export let preview: DraftProcessPreview
  export let documents: readonly AuthoringNativeDocument[]
  export let draftId: string

  const client = getClient()
  $: diagram = draftCodeMarkup(draftProcessDiagram(preview), 'mermaid')
  $: slots = Object.entries(preview.definition.requiredSlots ?? {})
  $: outputs = Object.entries(preview.definition.context).sort(([, left], [, right]) => left.index - right.index)

  function label (id: Ref<Doc>): IntlString {
    return client.getModel().findObject<Doc & { label?: IntlString }>(id)?.label ?? getEmbeddedLabel(id)
  }

  function stateName (id: Ref<State> | null): string {
    return id === null ? '▶' : (preview.states.find((state) => state._id === id)?.title ?? id)
  }

  function parameterLabel (key: string, methodId?: Ref<Method<Doc>>): IntlString {
    const slotKey = /^__SLOT_(.+)__$/.exec(key)?.[1]
    const slot = slotKey === undefined ? undefined : preview.definition.requiredSlots?.[slotKey]
    if (slot !== undefined) return slot.label ?? getEmbeddedLabel(slotKey ?? key)
    const method = methodId === undefined ? undefined : client.getModel().findObject(methodId)
    const owner =
      methodId === process.method.UpdateCard
        ? preview.definition.masterTag
        : (method?.objectClass ?? preview.definition.masterTag)
    const local = documents.find((doc) => doc.attributeOf === owner && doc.name === key)
    if (typeof local?.label === 'string') return local.label as IntlString
    const hierarchy = client.getHierarchy()
    const attribute =
      hierarchy.findClass(owner as Ref<Class<Doc>>) === undefined
        ? undefined
        : hierarchy.findAttribute(owner as Ref<Class<Doc>>, key)
    return attribute?.label ?? getEmbeddedLabel(key)
  }

  function valueText (value: unknown): string {
    if (typeof value === 'string') {
      const local = documents.find((doc) => doc._id === value)
      if (local !== undefined) return String(local.name ?? local.label ?? value).replace(/^embedded:embedded:/, '')
      return value
    }
    return JSON.stringify(value, null, 2) ?? '—'
  }
</script>

<div class="process-preview flex-col flex-no-shrink" data-id="package-draft-process">
  {#if preview.definition.description}<p class="description">{preview.definition.description}</p>{/if}
  <section class="flex-col flex-gap-3">
    <h3><Label label={marketplace.string.StateGraph} /></h3>
    <div class="diagram overflow-x-auto" data-id="package-draft-diagram"><MessageViewer message={diagram} /></div>
  </section>
  {#if slots.length > 0 || outputs.length > 0 || preview.definition.resultType !== undefined}
    <div class="contracts">
      {#if slots.length > 0}
        <section class="flex-col flex-gap-3">
          <h3><Label label={process.string.RequiredSlots} /></h3>
          <dl class="contract-list">
            {#each slots as [key, slot] (key)}
              <div>
                <dt><Label label={slot.label ?? getEmbeddedLabel(key)} /></dt>
                <dd><PackageDraftType value={'type' in slot ? slot.type : { _class: slot._class }} {documents} /></dd>
              </div>
            {/each}
          </dl>
        </section>
      {/if}
      {#if outputs.length > 0 || preview.definition.resultType !== undefined}
        <section class="flex-col flex-gap-3">
          <h3><Label label={marketplace.string.DeclaredOutputs} /></h3>
          <dl class="contract-list">
            {#if preview.definition.resultType !== undefined}
              <div>
                <dt><Label label={marketplace.string.FieldType} /></dt>
                <dd><PackageDraftType value={preview.definition.resultType} {documents} /></dd>
              </div>
            {/if}
            {#each outputs as [key, output] (key)}
              <div>
                <dt>{output.name || key}</dt>
                <dd><PackageDraftType value={output.type ?? { _class: output._class }} {documents} /></dd>
              </div>
            {/each}
          </dl>
        </section>
      {/if}
    </div>
  {/if}
  <section class="flex-col flex-gap-3">
    <h3><Label label={marketplace.string.Transitions} /></h3>
    {#each preview.transitions as transition, index (transition._id)}
      <div class="transition" data-id="package-draft-transition">
        <AccordionItem
          id={`draft-${draftId}-${preview.definition._id}-${transition._id}`}
          title={`${index + 1}. ${stateName(transition.from)} → ${stateName(transition.to)}`}
          size="large"
          kind="no-border"
          isOpen={index === 0}
          bottomSpace={false}
          contentAlign="stretch"
        >
          <div class="transition-body flex-col flex-gap-4">
            <div class="flex-col flex-gap-2">
              <div class="flex-row-center flex-wrap flex-gap-2">
                <span class="content-dark-color"><Label label={process.string.Trigger} /></span>
                <span class="font-medium"><Label label={label(transition.trigger)} /></span>
              </div>
              {#if Object.keys(transition.triggerParams).length > 0}
                <dl class="parameter-list">
                  {#each Object.entries(transition.triggerParams) as [key, value] (key)}
                    <div>
                      <dt><Label label={parameterLabel(key)} /></dt>
                      <dd><pre>{valueText(value)}</pre></dd>
                    </div>
                  {/each}
                </dl>
              {/if}
            </div>
            {#if transition.actions.length > 0}
              <div class="flex-col flex-gap-2">
                <span class="text-sm content-dark-color"><Label label={process.string.Actions} /></span>
                <ol class="actions">
                  {#each transition.actions as action (action._id)}
                    <li>
                      <span class="font-medium"><Label label={label(action.methodId)} /></span>
                      {#if Object.keys(action.params).length > 0}
                        <dl class="parameter-list">
                          {#each Object.entries(action.params) as [key, value] (key)}
                            <div>
                              <dt><Label label={parameterLabel(key, action.methodId)} /></dt>
                              <dd><pre>{valueText(value)}</pre></dd>
                            </div>
                          {/each}
                        </dl>
                      {/if}
                    </li>
                  {/each}
                </ol>
              </div>
            {/if}
          </div>
        </AccordionItem>
      </div>
    {/each}
  </section>
</div>

<style>
  h3,
  p,
  dl,
  dd {
    margin: 0;
  }
  h3 {
    font-size: 1rem;
    font-weight: 600;
  }
  .process-preview {
    gap: var(--spacing-6);
  }
  .description {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .diagram {
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--spacing-2);
    padding: var(--spacing-4);
    min-width: 0;
  }
  .contracts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: var(--spacing-6);
  }
  .contract-list > div {
    display: flex;
    justify-content: space-between;
    gap: var(--spacing-3);
    padding: var(--spacing-2) 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .contract-list dd {
    color: var(--theme-content-color);
    text-align: right;
  }
  .transition {
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--spacing-2);
  }
  .transition-body {
    padding: var(--spacing-3) var(--spacing-4) var(--spacing-4);
  }
  .actions {
    margin: 0;
    padding-left: var(--spacing-5);
  }
  .actions li {
    padding: var(--spacing-2) 0;
  }
  .parameter-list {
    margin-top: var(--spacing-2);
  }
  .parameter-list > div {
    display: grid;
    grid-template-columns: minmax(6rem, 1fr) minmax(0, 3fr);
    gap: var(--spacing-3);
    padding: var(--spacing-1) 0;
  }
  .parameter-list dt {
    color: var(--theme-dark-color);
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }
  .parameter-list pre {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
