<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { Analytics } from '@hcengineering/analytics'
  import { type MasterTag, type Tag } from '@hcengineering/card'
  import core, { type AnyAttribute, type Ref } from '@hcengineering/core'
  import { getResource } from '@hcengineering/platform'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import { type Context, type Process, type ProcessFunction } from '@hcengineering/process'
  import { type AnySvelteComponent } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'
  import ProcessAttribute from '../ProcessAttribute.svelte'

  export let func: ProcessFunction
  export let process: Process
  export let masterTag: Ref<MasterTag | Tag>
  export let context: Context
  export let attribute: AnyAttribute
  export let props: Record<string, unknown> = {}

  let value = typeof props.value === 'string' ? props.value : ''

  const dispatch = createEventDispatcher()
  const hierarchy = getClient().getHierarchy()

  function save (): void {
    dispatch('close', { value })
  }

  let editor: AnySvelteComponent | undefined

  function getEditor (): void {
    try {
      const inlineEditor = hierarchy.as(
        hierarchy.getClass(core.class.TypeMarkup),
        view.mixin.AttributeEditor
      ).inlineEditor
      void getResource(inlineEditor)
        .then((component) => {
          editor = component
        })
        .catch((error: unknown) => {
          Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
        })
    } catch (error: unknown) {
      Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  getEditor()
</script>

<Card on:close width={'x-small'} label={func.label} canSave okAction={save} okLabel={presentation.string.Save}>
  <div class="grid">
    <ProcessAttribute
      {process}
      {masterTag}
      {context}
      {attribute}
      presenterClass={{
        attrClass: core.class.TypeMarkup,
        category: 'attribute'
      }}
      {value}
      {editor}
      on:change={(event) => {
        value = event.detail
      }}
    />
  </div>
</Card>

<style lang="scss">
  .grid {
    display: grid;
    width: 100%;
    grid-template-columns: 1fr 1.5fr;
    grid-auto-rows: minmax(1rem, max-content);
    justify-content: start;
    align-items: center;
    row-gap: 0.25rem;
    column-gap: 1rem;
    height: min-content;
  }
</style>
