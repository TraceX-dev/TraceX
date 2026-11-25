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
  import { getClient, getPrintContext, getPreviewThumbnail } from '@hcengineering/presentation'
  import { tick } from 'svelte'
  import { loadPrintDecoration, type PrintDecoration } from '../decorations'

  export let object: Doc

  const context = getPrintContext()
  let decoration: PrintDecoration | undefined
  let iconDataUrl: string | undefined

  async function load (): Promise<void> {
    if (context === undefined) return
    const result = await loadPrintDecoration(getClient(), object)
    if (result?.icon != null) {
      const response = await fetch(getPreviewThumbnail(result.icon, 128, 128, 1))
      if (!response.ok) throw new Error('Print logo could not be loaded')
      const blob = await response.blob()
      iconDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error ?? new Error('Print logo could not be decoded'))
        reader.readAsDataURL(blob)
      })
    }
    decoration = result
    await tick()
  }

  const loading = load()
  void (context?.waitFor(loading, 15000) ?? loading).catch((error: unknown) => {
    context?.fail(error)
    Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
  })
  const rootStyle = /* css */ `
    width: 100%;
    font-family: 'IBM Plex Sans';
    font-size: 7pt;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    margin: 0 9mm;
  `

  const rowStyle = /* css */ `
    display: flex;
    align-items: center;
    justify-content: space-between;
    line-height: 150%;
    margin-bottom: 2mm;
  `

  const separatorStyle = /* css */ `
    border-bottom: 1px solid #cccccc;
    margin: 1px 0;
  `

  const logoContainerStyle = /* css */ `
    display: flex;
    align-items: center;
  `

  const logoStyle = /* css */ `
    width: 24pt;
    height: 24pt;
    border: none;
    margin-right: 4mm;
  `
</script>

{#if decoration !== undefined}
  <header style={rootStyle}>
    <div style={rowStyle}>
      <span style={logoContainerStyle}>
        {#if iconDataUrl}
          <img src={iconDataUrl} alt="" style={logoStyle} />
        {/if}
        {decoration.workspace}
      </span>
      <span style="white-space: pre-wrap;">{decoration.header}</span>
      <span>{decoration.data.reference ?? ''}</span>
    </div>
    <div style={separatorStyle} />
  </header>
{/if}
