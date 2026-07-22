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
  import { createEventDispatcher } from 'svelte'
  import { type MarkupNode } from '@hcengineering/text'
  import { MarkupDiffViewer } from '@hcengineering/text-editor-resources'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { Button, Scroller } from '@hcengineering/ui'

  // Current document content (before) and imported candidate (after).
  export let current: MarkupNode
  export let candidate: MarkupNode

  const dispatch = createEventDispatcher()
</script>

<div class="docx-import-popup antiPopup">
  <div class="header">Review imported changes</div>
  <Scroller>
    <div class="diff">
      <MarkupDiffViewer content={candidate} comparedVersion={current} />
    </div>
  </Scroller>
  <div class="footer">
    <Button label={getEmbeddedLabel('Cancel')} on:click={() => dispatch('close', false)} />
    <Button label={getEmbeddedLabel('Apply')} kind={'primary'} on:click={() => dispatch('close', true)} />
  </div>
</div>

<style lang="scss">
  .docx-import-popup {
    display: flex;
    flex-direction: column;
    width: 40rem;
    max-width: 90vw;
    height: 40rem;
    max-height: 80vh;
  }
  .header {
    padding: 1rem;
    font-weight: 500;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .diff {
    padding: 1rem;
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 1rem;
    border-top: 1px solid var(--theme-divider-color);
  }
</style>
