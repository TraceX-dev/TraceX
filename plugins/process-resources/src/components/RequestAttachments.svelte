<!--
//
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
  import attachment, { type Attachment } from '@hcengineering/attachment'
  import type { Card } from '@hcengineering/card'
  import type { DocumentQuery } from '@hcengineering/core'
  import { getResource, setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient, MessageViewer } from '@hcengineering/presentation'
  import type { EventButton } from '@hcengineering/process'
  import { type AnySvelteComponent, ModernDialog, Spinner } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'
  import process from '../plugin'

  export let action: EventButton
  export let card: Card

  const dispatch = createEventDispatcher()
  const client = getClient()
  const attachmentsQuery = createQuery()
  let editor: AnySvelteComponent | undefined
  let query: DocumentQuery<Attachment> = {}
  let attachments = 0
  let uploading = false
  let saving = false
  let disposed = false

  $: busy = uploading || saving
  $: canSubmit = !busy && attachments > 0

  onMount(() => {
    void initialize().catch(async (error: unknown) => {
      await setPlatformStatus(unknownError(error))
    })
    return () => {
      disposed = true
    }
  })

  async function initialize (): Promise<void> {
    const [component, existing] = await Promise.all([
      getResource(attachment.component.Attachments),
      client.findAll(attachment.class.Attachment, { attachedTo: card._id })
    ])
    if (disposed) return
    query = { _id: { $nin: existing.map((item) => item._id) } }
    attachmentsQuery.query(attachment.class.Attachment, { ...query, attachedTo: card._id }, (result) => {
      attachments = result.length
    })
    editor = component
  }

  export function canClose (): boolean {
    return !busy
  }

  function close (): void {
    if (!busy) dispatch('close')
  }

  async function submit (): Promise<void> {
    if (!canSubmit) return
    saving = true
    try {
      await client.createDoc(process.class.ProcessCustomEvent, action.space, {
        execution: action.execution,
        eventType: action.eventType,
        card: card._id
      })
      dispatch('close')
    } catch (error: unknown) {
      await setPlatformStatus(unknownError(error))
    } finally {
      saving = false
    }
  }
</script>

<ModernDialog
  label={process.string.RequestAttachments}
  {canSubmit}
  loading={busy}
  shouldCloseOnCancel={!busy}
  width="40rem"
  on:submit={submit}
  on:close={close}
>
  <div class="flex-col flex-gap-2">
    <div>{action.title}</div>
    {#if action.description}
      <MessageViewer message={action.description} />
    {/if}
    {#if editor !== undefined}
      <svelte:component
        this={editor}
        object={card}
        objectId={card._id}
        _class={card._class}
        space={card.space}
        {query}
        {attachments}
        readonly={saving}
        on:loading={(event) => {
          uploading = event.detail
        }}
      />
    {:else}
      <Spinner />
    {/if}
  </div>
</ModernDialog>
