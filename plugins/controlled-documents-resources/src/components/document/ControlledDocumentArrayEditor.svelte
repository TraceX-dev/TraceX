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
  import { type ControlledDocument, type DocumentMeta } from '@hcengineering/controlled-documents'
  import { type Doc, type Ref } from '@hcengineering/core'
  import { Button, IconAdd, IconDelete, showPopup } from '@hcengineering/ui'
  import { ObjectBoxPopup } from '@hcengineering/view-resources'

  import documents from '../../plugin'
  import ControlledDocumentInlineEditor from './ControlledDocumentInlineEditor.svelte'
  import ControlledDocumentVersionsSelectorPopup from './ControlledDocumentVersionsSelectorPopup.svelte'

  export let value: Array<Ref<ControlledDocument>> = []
  export let readonly: boolean = false
  export let onChange: (value: Array<Ref<ControlledDocument>>) => void

  let container: HTMLElement

  function addVersion (): void {
    if (readonly) return

    showPopup(
      ObjectBoxPopup,
      { _class: documents.class.DocumentMeta, placeholder: documents.string.ControlledDocument },
      container,
      (meta) => {
        if (meta === undefined) return

        showPopup(
          ControlledDocumentVersionsSelectorPopup,
          { meta: (meta as Doc)._id as Ref<DocumentMeta> },
          container,
          (version) => {
            if (version !== undefined && !value.includes(version)) {
              value = [...value, version]
              onChange(value)
            }
          }
        )
      }
    )
  }

  function removeVersion (version: Ref<ControlledDocument>): void {
    value = value.filter((item) => item !== version)
    onChange(value)
  }
</script>

<div bind:this={container} class="flex-col flex-gap-1">
  {#each value as version}
    <div class="flex-row-center flex-gap-1">
      <ControlledDocumentInlineEditor value={version} readonly />
      {#if !readonly}
        <Button
          kind="ghost"
          icon={IconDelete}
          size="small"
          on:click={() => {
            removeVersion(version)
          }}
        />
      {/if}
    </div>
  {/each}
  {#if !readonly}
    <Button kind="ghost" icon={IconAdd} size="small" on:click={addVersion} />
  {/if}
</div>
