<!--
//
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
//
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Label, Loading } from '@hcengineering/ui'
  import { getMetadata } from '@hcengineering/platform'
  import type { Blob as PlatformBlob, BlobMetadata, Ref } from '@hcengineering/core'
  import presentation from '../plugin'
  import { getCurrentWorkspaceUuid } from '../file'
  import { getPreviewMetadata, getPreviewThumbnail } from '../preview'
  import { registerPrintResource } from '../print'
  import { fetchPrintFile } from '../print-file'
  import { imageSizeToRatio } from '../image'

  export let file: Ref<PlatformBlob> | string
  export let name: string
  export let contentType: string
  export let metadata: BlobMetadata | undefined = undefined
  export let sourceLink: string | undefined = undefined

  $: imageWidth =
    contentType.startsWith('image/') && metadata?.originalWidth !== undefined
      ? imageSizeToRatio(metadata.originalWidth, metadata.pixelRatio ?? 1)
      : undefined

  let image: string | undefined
  let text: string | undefined
  let failed = false
  let loading = true
  let timeout: number | undefined
  let generation = 0
  let controller: AbortController | undefined
  let finish = (): void => {}

  function complete (): void {
    window.clearTimeout(timeout)
    loading = false
    finish()
  }

  async function prepare (file: string, name: string, contentType: string): Promise<void> {
    const request = ++generation
    controller?.abort()
    window.clearTimeout(timeout)
    finish()
    controller = new AbortController()
    const abort = controller
    const done = registerPrintResource()
    finish = done
    timeout = window.setTimeout(() => {
      if (request === generation) {
        abort.abort()
        failed = true
        complete()
      }
    }, 15000)
    if (image !== undefined) URL.revokeObjectURL(image)
    image = undefined
    text = undefined
    failed = false
    loading = true
    try {
      if (!(
        contentType === 'application/pdf' ||
        contentType.startsWith('image/') ||
        contentType.startsWith('text/') ||
        contentType === 'application/json'
      )) {
        throw new Error('Content type cannot be printed inline')
      }
      const pdf = contentType === 'application/pdf'
      const response = await fetchPrintFile(file, name, {
        method: pdf ? 'HEAD' : 'GET',
        signal: abort.signal
      })
      if (!response.ok) throw new Error('File could not be loaded')
      if (pdf) {
        if ((getMetadata(presentation.metadata.PreviewUrl) ?? '') === '') throw new Error('Preview unavailable')
        const metadata = await getPreviewMetadata(getCurrentWorkspaceUuid(), file)
        if (request !== generation) return
        const thumbnail = metadata.thumbnail
        if (thumbnail === undefined || thumbnail.width <= 0 || thumbnail.height <= 0)
          throw new Error('Preview unavailable')
        const width = 1200
        const height = Math.round((width * thumbnail.height) / thumbnail.width)
        const preview = await fetch(getPreviewThumbnail(file, width, height, 1), {
          credentials: 'omit',
          signal: abort.signal
        })
        if (!preview.ok) throw new Error('Preview could not be loaded')
        const blob = await preview.blob()
        if (request !== generation) return
        image = URL.createObjectURL(blob)
      } else if (contentType.startsWith('image/')) {
        const blob = await response.blob()
        if (request !== generation) return
        image = URL.createObjectURL(blob)
      } else if (contentType.startsWith('text/') || contentType === 'application/json') {
        const value = await response.text()
        if (request !== generation) return
        text = value
        complete()
      } else {
        throw new Error('Content type cannot be printed inline')
      }
    } catch {
      if (request === generation) {
        failed = true
        complete()
      }
    } finally {
      if (request !== generation) done()
    }
  }

  $: void prepare(file, name, contentType)

  onDestroy(() => {
    generation++
    controller?.abort()
    window.clearTimeout(timeout)
    finish()
    if (image !== undefined) URL.revokeObjectURL(image)
  })
</script>

<figure
  class="flex-col gap-2 m-0"
  data-print-resource
  data-print-resource-state={loading ? 'loading' : failed ? 'placeholder' : 'ready'}
>
  {#if loading}<Loading />{/if}
  {#if failed}
    <figcaption><Label label={presentation.string.FailedToPreview} />: {name}</figcaption>
  {:else if image !== undefined}
    <img
      src={image}
      alt={name}
      class="object-contain self-start w-auto"
      style:max-width={imageWidth !== undefined ? `min(100%, ${imageWidth}px)` : '100%'}
      on:load={complete}
      on:error={() => {
        failed = true
        complete()
      }}
    />
  {:else if text !== undefined}
    <pre class="m-0">{text}</pre>
  {/if}
  {#if sourceLink !== undefined}
    <a href={sourceLink}>{name}</a>
  {:else}
    <figcaption>{name}</figcaption>
  {/if}
</figure>

<style>
  figure {
    break-inside: avoid;
  }
  img {
    height: auto;
    max-height: 25cm;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
