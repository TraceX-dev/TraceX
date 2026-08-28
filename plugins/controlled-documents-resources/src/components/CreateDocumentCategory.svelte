<!--
//
// Copyright © 2023 Hardcore Engineering Inc.
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
  import { createEventDispatcher } from 'svelte'
  import { Attachment } from '@hcengineering/attachment'
  import { AttachmentPresenter, AttachmentStyledBox } from '@hcengineering/attachment-resources'
  import { generateId, type Ref, type TypedSpace } from '@hcengineering/core'
  import { Card, getClient, SpaceSelector } from '@hcengineering/presentation'
  import { Button, EditBox, IconAttachment, tooltip } from '@hcengineering/ui'
  import { type DocumentCategory, type DocumentSpace } from '@hcengineering/controlled-documents'
  import { checkMyPermission, permissionsStore } from '@hcengineering/contact-resources'

  import IconWarning from './icons/IconWarning.svelte'
  import documents from '../plugin'

  const _id = generateId<DocumentCategory>()
  export let space: Ref<DocumentSpace> | undefined = undefined
  let code: string = ''
  let _title: string = ''
  $: title = _title.trim()
  let description: string = ''

  const dispatch = createEventDispatcher()
  const client = getClient()
  let descriptionBox: AttachmentStyledBox

  $: restrictedSpaces = Object.keys($permissionsStore.ps).filter(
    (id) => !checkMyPermission(documents.permission.CreateDocumentCategory, id as Ref<TypedSpace>, $permissionsStore)
  ) as Ref<TypedSpace>[]
  $: spaceQuery = { _id: { $nin: restrictedSpaces }, archived: false }
  $: canCreate =
    space !== undefined && checkMyPermission(documents.permission.CreateDocumentCategory, space, $permissionsStore)

  async function handleOkAction (): Promise<void> {
    if (isCodeWrong || isTitleWrong || !canCreate || space === undefined) {
      return
    }
    const op = client.apply()
    await op.createDoc(
      documents.class.DocumentCategory,
      space,
      {
        title,
        code,
        description,
        attachments: 0
      },
      _id
    )
    await descriptionBox.createAttachments(_id, op)
    await op.commit()
    dispatch('close', _id)
  }

  let existingCategories: string[] = []
  let existingCodes: string[] = []
  $: void client.findAll(documents.class.DocumentCategory, space === undefined ? {} : { space }).then((cats) => {
    existingCategories = cats.map((cat) => cat.title)
    existingCodes = cats.map((cat) => cat.code)
  })

  let isCodeWrong: boolean = false
  let isCodeInUse: boolean = false
  $: isCodeInUse = existingCodes.includes(code)
  $: isCodeWrong = code === '' || isCodeInUse

  let isTitleWrong: boolean = false
  let isTitleInUse: boolean = false
  $: isTitleInUse = existingCategories.includes(title)
  $: isTitleWrong = title === '' || isTitleInUse

  let attachments: Map<Ref<Attachment>, Attachment> = new Map<Ref<Attachment>, Attachment>()
</script>

<Card
  label={documents.string.CreateDocumentCategory}
  okAction={handleOkAction}
  canSave={!isCodeWrong && !isTitleWrong && canCreate}
  hideAttachments={attachments.size === 0}
  on:close={() => {
    dispatch('close')
  }}
>
  <svelte:fragment slot="header">
    <SpaceSelector
      _class={documents.class.DocumentSpace}
      query={spaceQuery}
      bind:space
      label={documents.string.Space}
      kind="regular"
      size="small"
      autoSelect={true}
    />
  </svelte:fragment>
  <div>
    <div class="flex-row-center flex-between title-editbox">
      <EditBox
        placeholder={documents.string.Title}
        bind:value={_title}
        kind={'large-style'}
        required
        focusIndex={1}
        maxWidth={'38rem'}
        autoFocus
        on:input={() => {
          code = _title
            .split(' ')
            .map((it) => it[0]?.toUpperCase())
            .filter((it) => it)
            .join('')
        }}
      />
      <div class="icon-placeholder">
        {#if isTitleInUse}
          <div
            use:tooltip={{ label: documents.string.DocumentCategoryAlreadyExists, props: { title }, direction: 'left' }}
          >
            <IconWarning size="small" />
          </div>
        {/if}
      </div>
    </div>
    <div class="flex-row-center flex-between code-editbox">
      <EditBox
        placeholder={documents.string.Code}
        bind:value={code}
        kind={'large-style'}
        required
        focusIndex={2}
        maxWidth={'38rem'}
        on:input={() => {
          code = code.trim()
        }}
      />
      <div class="icon-placeholder">
        {#if isCodeInUse}
          <div
            use:tooltip={{
              label: documents.string.DocumentCategoryCodeAlreadyExists,
              props: { code },
              direction: 'left'
            }}
          >
            <IconWarning size="small" />
          </div>
        {/if}
      </div>
    </div>
  </div>
  <div class="description-box">
    <AttachmentStyledBox
      bind:this={descriptionBox}
      bind:content={description}
      placeholder={documents.string.Description}
      objectId={_id}
      _class={documents.class.DocumentCategory}
      {space}
      focusIndex={3}
      alwaysEdit
      showButtons={false}
      kind={'normal'}
      isScrollable={false}
      enableAttachments={false}
      on:attachments={(ev) => {
        if (ev.detail.size > 0) attachments = ev.detail.values
        else if (ev.detail.size === 0 && ev.detail.values === true) {
          attachments.clear()
          attachments = attachments
        }
      }}
    />
  </div>
  <svelte:fragment slot="attachments">
    {#if attachments.size > 0}
      {#each Array.from(attachments.values()) as attachment}
        <AttachmentPresenter
          value={attachment}
          showPreview
          removable
          on:remove={(result) => {
            if (result.detail !== undefined) descriptionBox.removeAttachmentById(result.detail._id)
          }}
        />
      {/each}
    {/if}
  </svelte:fragment>
  <svelte:fragment slot="footer">
    <Button
      focusIndex={10}
      icon={IconAttachment}
      iconProps={{ fill: 'var(--theme-dark-color)' }}
      size={'large'}
      kind={'ghost'}
      on:click={() => {
        descriptionBox.handleAttach()
      }}
    />
  </svelte:fragment>
</Card>

<style lang="scss">
  .category-warning-message {
    color: var(--highlight-red);
  }

  .title-editbox {
    padding: 0rem 0.5rem 0.5rem 0.75rem;
  }

  .code-editbox {
    padding: 0.5rem 0.5rem 0.5rem 0.75rem;
  }

  .description-box {
    padding: 0.5rem 0.5rem 0rem 0.75rem;

    :global(.tiptap-left-menu) {
      display: none;
    }

    :global(.select-text) {
      padding-left: 0;
    }
  }

  .icon-placeholder {
    width: 1rem;
  }
</style>
