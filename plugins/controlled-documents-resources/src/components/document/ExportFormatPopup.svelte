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
  import { type ControlledDocument } from '@hcengineering/controlled-documents'
  import { SelectPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { exportDocument } from '../../docxActions'

  export let value: ControlledDocument | ControlledDocument[]
  export let width: 'medium' | 'large' | 'full' = 'medium'

  const dispatch = createEventDispatcher()
  const doc = Array.isArray(value) ? value[0] : value
  const formats = [
    { id: 'docx', text: 'Word (.docx)' },
    { id: 'md', text: 'Markdown (.md)' }
  ]
</script>

<SelectPopup
  value={formats}
  {width}
  on:close={(evt) => {
    const format = evt.detail
    if (typeof format === 'string' && doc !== undefined) {
      void exportDocument(doc, format)
    }
    dispatch('close')
  }}
/>
