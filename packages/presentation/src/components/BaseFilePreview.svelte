<!--
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
  import type { BlobMetadata } from '@hcengineering/core'
  import { Image, Label, trackRenderResource } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'
  import { getCurrentWorkspaceUuid } from '../file'
  import { getPreviewMetadata, getPreviewThumbnail } from '../preview'
  import presentation from '../plugin'

  export let file: string
  export let name: string
  export let metadata: BlobMetadata | undefined

  let src: string | undefined
  let loading = true
  let generation = 0
  const trackLoading = trackRenderResource({ timeoutMs: 30000, onTimeout: finishPreview })
  $: trackLoading(loading)
  onDestroy(() => {
    generation++
  })

  function finishPreview (): void {
    generation++
    src = undefined
    loading = false
  }

  async function loadPreview (file: string, metadata: BlobMetadata | undefined): Promise<void> {
    const request = ++generation
    src = undefined
    loading = true
    try {
      const thumbnail = file.includes('://')
        ? undefined
        : (metadata?.thumbnail ?? (await getPreviewMetadata(getCurrentWorkspaceUuid(), file)).thumbnail)
      if (request !== generation) return
      if (thumbnail === undefined) {
        loading = false
      } else {
        src = getPreviewThumbnail(file, thumbnail.width, thumbnail.height, 2)
      }
    } catch {
      if (request === generation) finishPreview()
    }
  }

  $: void loadPreview(file, metadata)
</script>

<div class="flex-col flex-gap-3" data-id="base-file-preview">
  {#if src !== undefined}
    <div class="first-page" data-id="base-file-first-page">
      <Image {src} alt={name} width="100%" height="auto" on:load={() => (loading = false)} on:error={finishPreview} />
    </div>
  {:else if !loading}
    <Label label={presentation.string.FailedToPreview} />
  {/if}
</div>

<style lang="scss">
  .first-page {
    width: min(100%, 14cm);
  }
</style>
