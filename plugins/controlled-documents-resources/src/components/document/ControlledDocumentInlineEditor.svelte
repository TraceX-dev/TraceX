<!--
//
// Copyright © 2024 Hardcore Engineering Inc.
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
  import { type ControlledDocument, type DocumentMeta } from '@hcengineering/controlled-documents'
  import { AnyAttribute, type Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { Button, ButtonKind, ButtonSize, Label, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import documents from '../../plugin'
  import DocumentMetaPresenter from '../DocumentMetaPresenter.svelte'
  import ControlledDocumentsPopup from './ControlledDocumentsPopup.svelte'
  import { IntlString } from '@hcengineering/platform'
  import DocumentPresenter from './presenters/DocumentPresenter.svelte'
  import DocumentVersionPresenter from './presenters/DocumentVersionPresenter.svelte'

  export let value: Ref<ControlledDocument | DocumentMeta> | undefined
  export let readonly: boolean = false
  export let label: IntlString = documents.string.ControlledDocument
  export let onChange: (value: Ref<ControlledDocument | DocumentMeta> | undefined) => void
  export let attribute: AnyAttribute | undefined = undefined

  export let focusIndex: number | undefined = undefined
  export let kind: ButtonKind = 'no-border'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'left'
  export let width: string | undefined = 'min-content'

  const documentQuery = createQuery()
  const metaQuery = createQuery()
  const dispatch = createEventDispatcher()
  let document: ControlledDocument | undefined
  let meta: DocumentMeta | undefined

  $: if (value === undefined) {
    document = undefined
  } else {
    documentQuery.query(documents.class.ControlledDocument, { _id: value as Ref<ControlledDocument> }, (result) => {
      ;[document] = result
    })
  }

  $: if (value === undefined) {
    meta = undefined
  } else {
    metaQuery.query(documents.class.DocumentMeta, { _id: value as Ref<DocumentMeta> }, (result) => {
      ;[meta] = result
    })
  }

  function openPopup (event: MouseEvent): void {
    event.stopPropagation()
    if (readonly) return

    showPopup(
      ControlledDocumentsPopup,
      { selected: value },
      eventToHTMLElement(event),
      (result: ControlledDocument | DocumentMeta | undefined) => {
        if (result === undefined || value === result._id) return

        value = result._id
        dispatch('change', value)
        dispatch('value', result)
        onChange(value)
      }
    )
  }
</script>

{#if readonly || attribute?.readonly}
  {#if document}
    <div class="flex-row-center">
      <DocumentPresenter value={document} withTitle withIcon />
      <span class="ml-1"><DocumentVersionPresenter value={document} /></span>
    </div>
  {:else if meta}
    <div class="flex-row-center">
      <DocumentMetaPresenter value={meta} />
      <span class="ml-2"><Label label={documents.string.LatestVersionHint} /></span>
    </div>
  {/if}
{:else}
  <Button
    showTooltip={{ label }}
    {justify}
    width={width ?? 'min-content'}
    {focusIndex}
    {size}
    {kind}
    disabled={readonly}
    on:click={openPopup}
  >
    <span slot="content" class="overflow-label">
      {#if document}
        <span class="flex-row-center">
          <DocumentPresenter value={document} withTitle withIcon disableLink />
          <span class="ml-1"><DocumentVersionPresenter value={document} /></span>
        </span>
      {:else if meta}
        <span class="flex-row-center">
          <DocumentMetaPresenter value={meta} />
          <span class="ml-2"><Label label={documents.string.LatestVersionHint} /></span>
        </span>
      {:else}
        <Label {label} />
      {/if}
    </span>
  </Button>
{/if}
