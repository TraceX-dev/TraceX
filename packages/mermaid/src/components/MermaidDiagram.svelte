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
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { themeStore } from '@hcengineering/theme'
  import { onDestroy, onMount } from 'svelte'
  import { renderMermaidSvg } from '../mermaid'

  export let code: string
  export let preview = false

  let mounted = false
  let requestId = 0
  let svg: string | undefined
  let error: string | undefined
  let renderState: 'empty' | 'pending' | 'ready' | 'error' = 'pending'

  $: if (mounted) {
    void render(code, $themeStore?.dark === true ? 'dark' : 'default')
  }

  async function render (code: string, theme: 'dark' | 'default'): Promise<void> {
    const currentRequestId = ++requestId
    svg = undefined
    error = undefined
    renderState = code.trim().length === 0 ? 'empty' : 'pending'
    if (renderState === 'empty') return

    try {
      const result = await renderMermaidSvg(code, theme)
      if (!mounted || currentRequestId !== requestId) return
      svg = result
      renderState = 'ready'
    } catch (err: unknown) {
      if (!mounted || currentRequestId !== requestId) return
      error = err instanceof Error ? err.message : String(err)
      renderState = 'error'
    }
  }

  onMount(() => {
    mounted = true
  })

  onDestroy(() => {
    mounted = false
    requestId++
  })
</script>

<div class="proseMermaidDiagram folded" data-mermaid-render-state={renderState} style:margin={preview ? '0' : undefined}>
  {#if svg !== undefined}
    <div class="mermaidPreviewContainer">
      <div class="mermaidPreview">
        <!-- The shared renderer sanitizes Mermaid output using strict security. -->
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html svg}
      </div>
    </div>
  {:else if code.trim().length > 0}
    <pre class="proseCodeBlock"><code>{code}</code></pre>
  {/if}
  {#if error !== undefined}
    <div role="status">{error}</div>
  {/if}
</div>
