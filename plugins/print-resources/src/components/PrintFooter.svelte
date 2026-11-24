<!--
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
  import type { Doc } from '@hcengineering/core'
  import { Analytics } from '@hcengineering/analytics'
  import { getClient, getPrintContext } from '@hcengineering/presentation'
  import { tick } from 'svelte'
  import { loadPrintDecoration, type PrintDecoration } from '../decorations'

  export let object: Doc

  const context = getPrintContext()
  let decoration: PrintDecoration | undefined
  async function load (): Promise<void> {
    if (context === undefined) return
    decoration = await loadPrintDecoration(getClient(), object)
    await tick()
  }

  const loading = load()
  void (context?.waitFor(loading, 15000) ?? loading).catch((error: unknown) => {
    context?.fail(error)
    Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
  })
  import { Label } from '@hcengineering/ui'
  import print from '@hcengineering/print'

  const rootStyle = /* css */ `
    width: 100%;
    font-family: 'IBM Plex Sans';
    font-size: 6pt;
    display: flex;
    align-items: center;
    gap: 1cm;
    margin: 0 9.5mm;
  `

  const metaStyle = /* css */ `
    flex: 0 0 auto;
    font-size: 7pt;
  `

  const sideStyle = /* css */ `
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: center;
  `

  const centerStyle = /* css */ `
    flex: 0 0 auto;
    font-size: 7pt;
    text-align: center;
    white-space: nowrap;
  `

  // Note: cannot use standard puppeteer "date" class as format cannot be easily adjusted for it
  const dtf = new Intl.DateTimeFormat('default', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZoneName: 'short'
  })
</script>

{#if decoration !== undefined}
  <footer style={rootStyle}>
    <div style={sideStyle}>
      {#if decoration.data.templateReference}
        <Label label={print.string.CreatedFromTemplate} />
        <span>{decoration.data.templateReference}</span>
      {/if}
    </div>
    <div style={centerStyle}>
      <span style="white-space: pre-wrap;">{decoration.footer}</span>
    </div>
    <div style={`${sideStyle} justify-content: flex-end; gap: 1cm;`}>
      <div style={metaStyle}>
        {dtf.format(new Date())}
      </div>
      <div style={metaStyle}>
        <Label label={print.string.Page} />
        <span class="pageNumber" />
        <Label label={print.string.Of} />
        <span class="totalPages" />
      </div>
    </div>
  </footer>
{/if}
