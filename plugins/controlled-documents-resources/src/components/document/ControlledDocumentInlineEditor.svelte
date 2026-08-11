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
  import { type Doc, type Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { Button, ButtonKind, ButtonSize, Label, showPopup } from '@hcengineering/ui'
  import { ObjectBoxPopup } from '@hcengineering/view-resources'

  import documents from '../../plugin'
  import { getDocumentVersionString } from '../../utils'
  import ControlledDocumentVersionsSelectorPopup from './ControlledDocumentVersionsSelectorPopup.svelte'

  export let value: Ref<ControlledDocument> | undefined
  export let readonly: boolean = false
  export let kind: ButtonKind = 'no-border'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'center'
  export let width: string | undefined = undefined

  const query = createQuery()
  let document: ControlledDocument | undefined
  let container: HTMLElement

  $: query.query(documents.class.ControlledDocument, { _id: value }, (result) => {
    ;[document] = result
  })

  function selectVersion (): void {
    if (readonly) return

    showPopup(
      ObjectBoxPopup,
      { _class: documents.class.DocumentMeta, placeholder: documents.string.ControlledDocument },
      container,
      (meta) => {
        if (meta === undefined) return

        showPopup(
          ControlledDocumentVersionsSelectorPopup,
          { meta: (meta as Doc)._id as Ref<DocumentMeta>, selected: value },
          container,
          (version) => {
            if (version !== undefined) {
              value = version
            }
          }
        )
      }
    )
  }
</script>

<div bind:this={container} class="min-w-0" class:w-full={width === '100%'}>
  <Button width={width ?? 'min-content'} {kind} {size} {justify} disabled={readonly} on:click={selectVersion}>
    <span slot="content" class="overflow-label">
      {#if document}
        {document.title} ({getDocumentVersionString(document)})
      {:else}
        <Label label={documents.string.ControlledDocument} />
      {/if}
    </span>
  </Button>
</div>
