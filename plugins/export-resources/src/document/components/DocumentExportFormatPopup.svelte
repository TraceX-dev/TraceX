<!--
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
-->
<script lang="ts">
  import { type Doc } from '@hcengineering/core'
  import exportPlugin from '@hcengineering/export'
  import { translate } from '@hcengineering/platform'
  import { SelectPopup, themeStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { exportDocumentContent } from '../actions'

  export let value: Doc | Doc[]
  export let width: 'medium' | 'large' | 'full' = 'medium'

  const dispatch = createEventDispatcher()
  const doc = Array.isArray(value) ? value[0] : value

  async function getFormats (): Promise<Array<{ id: string, text: string }>> {
    const lang = $themeStore.language
    return [
      { id: 'docx', text: await translate(exportPlugin.string.ExportFormatWord, {}, lang) },
      { id: 'md', text: await translate(exportPlugin.string.ExportFormatMarkdown, {}, lang) }
    ]
  }
</script>

{#await getFormats() then formats}
  <SelectPopup
    value={formats}
    {width}
    on:close={(evt) => {
      const format = evt.detail
      if (typeof format === 'string' && doc !== undefined) {
        void exportDocumentContent(doc, format)
      }
      dispatch('close')
    }}
  />
{/await}
