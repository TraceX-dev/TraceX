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
  import { type Ref } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Button, type ButtonKind, type ButtonSize, eventToHTMLElement, Label, showPopup } from '@hcengineering/ui'
  import { ObjectsTooltipWrapper } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import documents from '../../plugin'
  import DocumentMetaPresenter from '../DocumentMetaPresenter.svelte'
  import ControlledDocumentsPopup from './ControlledDocumentsPopup.svelte'
  import DocumentPresenter from './presenters/DocumentPresenter.svelte'
  import DocumentVersionPresenter from './presenters/DocumentVersionPresenter.svelte'

  export let value: Array<Ref<ControlledDocument | DocumentMeta>> | Ref<ControlledDocument | DocumentMeta> | undefined
  export let readonly: boolean = false
  export let label: IntlString | undefined = undefined
  export let onChange: ((value: Array<Ref<ControlledDocument | DocumentMeta>>) => void) | undefined = undefined
  export let focusIndex: number | undefined = undefined
  export let kind: ButtonKind = 'ghost'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'left'
  export let width: string | undefined = 'min-content'

  const client = getClient()
  const dispatch = createEventDispatcher()
  const icon = client.getHierarchy().getClass(documents.class.ControlledDocument).icon

  function toArray (
    value: Array<Ref<ControlledDocument | DocumentMeta>> | Ref<ControlledDocument | DocumentMeta> | undefined
  ): Array<Ref<ControlledDocument | DocumentMeta>> {
    return value === undefined ? [] : Array.isArray(value) ? value : [value]
  }

  function openPopup (event: MouseEvent): void {
    if (onChange === undefined || readonly) return
    event.stopPropagation()

    showPopup(
      ControlledDocumentsPopup,
      { selectedObjects: toArray(value), multiSelect: true },
      eventToHTMLElement(event),
      undefined,
      (result: Array<Ref<ControlledDocument | DocumentMeta>>) => {
        onChange?.(result)
        dispatch('change', result)
      }
    )
  }

  let docs: ControlledDocument[] = []
  let metas: DocumentMeta[] = []
  const documentQuery = createQuery()
  const metaQuery = createQuery()
  $: if (toArray(value).length === 0) {
    docs = []
  } else {
    documentQuery.query(
      documents.class.ControlledDocument,
      { _id: { $in: toArray(value) as Ref<ControlledDocument>[] } },
      (result) => {
        docs = result
      }
    )
  }
  $: if (toArray(value).length === 0) {
    metas = []
  } else {
    metaQuery.query(documents.class.DocumentMeta, { _id: { $in: toArray(value) as Ref<DocumentMeta>[] } }, (result) => {
      metas = result
    })
  }

  $: emptyLabel = label ?? documents.string.ControlledDocument
</script>

<ObjectsTooltipWrapper
  selectedCount={toArray(value).length}
  objects={[...docs, ...metas]}
  objectIds={toArray(value)}
  label={emptyLabel}
  {readonly}
  {width}
>
  <Button
    {justify}
    {focusIndex}
    width="100%"
    {size}
    icon={toArray(value).length === 1 ? undefined : icon}
    {kind}
    disabled={readonly}
    on:click={openPopup}
  >
    <div slot="content" class="overflow-label">
      {#if toArray(value).length === 1 && docs.length === 1}
        <span class="flex-row-center">
          <DocumentPresenter value={docs[0]} withTitle withIcon disableLink />
          <span class="ml-1"><DocumentVersionPresenter value={docs[0]} /></span>
        </span>
      {:else if toArray(value).length === 1 && metas.length === 1}
        <span class="flex-row-center">
          <DocumentMetaPresenter value={metas[0]} />
          <span class="ml-2"><Label label={documents.string.LatestVersionHint} /></span>
        </span>
      {:else if toArray(value).length > 1}
        <div class="lower">{toArray(value).length} <Label label={documents.string.ControlledDocument} /></div>
      {:else}
        <Label label={emptyLabel} />
      {/if}
    </div>
  </Button>
</ObjectsTooltipWrapper>
