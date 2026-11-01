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
  import { type Blob, type Ref } from '@hcengineering/core'
  import { getMetadata } from '@hcengineering/platform'
  import presentation, {
    fetchPreviewFile,
    FilePreviewSession,
    getCurrentWorkspaceUuid,
    getFileUrl,
    getPreviewMetadata,
    getPreviewThumbnail
  } from '@hcengineering/presentation'
  import { EmbeddedPDF, Label, Loading } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'
  import ImageViewer from './ImageViewer.svelte'

  export let value: Ref<Blob>
  export let name: string
  export let fit: boolean = false
  export let preview: FilePreviewSession | undefined = undefined

  let src: string | undefined
  let failed = false
  let loading = true
  let generation = 0
  let attempt: FilePreviewSession | undefined
  let objectUrl: string | undefined
  $: staticView = preview?.mode === 'static'

  async function prepare (value: string, name: string, owner: FilePreviewSession | undefined): Promise<void> {
    const request = ++generation
    const session = owner ?? new FilePreviewSession()
    if (attempt !== session) attempt?.destroy()
    attempt = session
    if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    objectUrl = undefined
    src = undefined
    failed = false
    loading = true
    try {
      if (session.mode === 'interactive' && value.includes('://')) {
        src = getFileUrl(value, name)
        loading = false
        return
      }
      const response = await fetchPreviewFile(value, name, {
        method: session.mode === 'static' ? 'HEAD' : 'GET',
        signal: session.signal
      })
      if (session.mode === 'static') {
        if ((getMetadata(presentation.metadata.PreviewUrl) ?? '') === '') throw new Error('Preview unavailable')
        const metadata = await getPreviewMetadata(getCurrentWorkspaceUuid(), value, session.signal)
        const thumbnail = metadata.thumbnail
        if (thumbnail === undefined || thumbnail.width <= 0 || thumbnail.height <= 0)
          throw new Error('Preview unavailable')
        if (request !== generation || session.signal.aborted) return
        src = getPreviewThumbnail(value, 1200, Math.round((1200 * thumbnail.height) / thumbnail.width), 1)
      } else {
        const blob = await response.blob()
        if (request !== generation || session.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        src = objectUrl
      }
      loading = false
    } catch (error) {
      if (request !== generation) return
      failed = true
      loading = false
      session.fail(error)
    }
  }

  $: void prepare(value, name, preview)
  onDestroy(() => {
    generation++
    attempt?.destroy()
    if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
  })
</script>

{#if failed}
  <Label label={presentation.string.FailedToPreview} />
{:else if loading}
  <div class="flex-center w-full clear-mins"><Loading /></div>
{:else if src !== undefined}
  {#if staticView}
    <ImageViewer {value} {name} source={src} metadata={undefined} {preview} />
  {:else}
    <EmbeddedPDF
      {src}
      {name}
      {fit}
      on:load={() => {
        attempt?.ready()
      }}
    />
  {/if}
{/if}
