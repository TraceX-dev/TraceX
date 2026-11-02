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
  import { type Blob, type Ref, type BlobMetadata } from '@hcengineering/core'
  import {
    DrawingBoard,
    FilePreviewSession,
    getBlobRef,
    imageSizeToRatio,
    type DrawingData
  } from '@hcengineering/presentation'
  import presentation from '@hcengineering/presentation'
  import { Label, Loading } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'

  export let value: Ref<Blob>
  export let name: string
  export let metadata: BlobMetadata | undefined
  export let fit: boolean = false
  export let source: string | undefined = undefined
  export let preview: FilePreviewSession | undefined = undefined

  export let drawingAvailable: boolean = false
  export let drawingEditable: boolean = false
  export let drawings: DrawingData[] = []
  export let createDrawing: (data: unknown) => Promise<void> = async () => {}
  export let setLoading: ((loading: boolean) => void) | undefined = undefined

  $: staticView = preview?.mode === 'static'
  $: imageWidth =
    metadata?.originalWidth != null ? imageSizeToRatio(metadata.originalWidth, metadata.pixelRatio ?? 1) : undefined
  $: imageHeight =
    metadata?.originalHeight != null ? imageSizeToRatio(metadata.originalHeight, metadata.pixelRatio ?? 1) : undefined
  $: width = imageWidth != null ? `min(${imageWidth}px, 100%)` : '100%'
  $: heightLimit = staticView ? '25cm' : fit ? '100%' : '80vh'
  $: height = imageHeight != null ? `min(${imageHeight}px, ${heightLimit})` : heightLimit

  let loading = true
  let failed = false
  let url: string | undefined
  let srcset: string | undefined
  let generation = 0
  let attempt: FilePreviewSession | undefined

  async function prepare (
    value: string,
    name: string,
    source: string | undefined,
    owner: FilePreviewSession | undefined
  ): Promise<void> {
    const request = ++generation
    const session = owner ?? new FilePreviewSession()
    if (attempt !== session) attempt?.destroy()
    attempt = session
    url = undefined
    srcset = undefined
    loading = true
    failed = false
    setLoading?.(true)
    try {
      const blobRef = await getBlobRef((source ?? value) as Ref<Blob>, name)
      if (request !== generation || session.signal.aborted) return
      url = blobRef.src
      srcset = blobRef.srcset
    } catch (error) {
      if (request !== generation) return
      failed = true
      loading = false
      setLoading?.(false)
      session.fail(error)
    }
  }

  async function loaded (event: Event): Promise<void> {
    const image = event.currentTarget as HTMLImageElement
    const session = attempt
    try {
      await image.decode()
      if (session !== attempt || session?.signal.aborted === true) return
      loading = false
      setLoading?.(false)
      session?.ready()
    } catch (error) {
      session?.fail(error)
      failed = true
      loading = false
      setLoading?.(false)
    }
  }

  function failedImage (): void {
    if (attempt?.signal.aborted === true) return
    failed = true
    loading = false
    setLoading?.(false)
    attempt?.fail(new Error('Image could not be decoded'))
  }

  $: void prepare(value, name, source, preview)

  onDestroy(() => {
    generation++
    attempt?.destroy()
  })
</script>

{#if failed}
  <Label label={presentation.string.FailedToPreview} />
{:else}
  {#if loading}
    <div class="flex-center w-full clear-mins"><Loading /></div>
  {/if}
  {#if url !== undefined}
    <DrawingBoard
      {imageWidth}
      {imageHeight}
      {drawings}
      {createDrawing}
      active={drawingAvailable && !loading}
      readonly={staticView || !drawingEditable}
      class="flex-center clear-mins w-full h-full"
      style={`max-width:${width};max-height:${height}`}
    >
      <img
        src={url}
        {srcset}
        alt={name}
        class="object-contain mx-auto"
        style:max-width={width}
        style:max-height={height}
        style:height={loading ? '0' : 'auto'}
        on:load={loaded}
        on:error={failedImage}
      />
    </DrawingBoard>
  {/if}
{/if}
