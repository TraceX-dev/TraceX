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
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import core, { type AccountUuid, type Doc, getCurrentAccount, type Markup } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { EmptyMarkup, isEmptyMarkup } from '@hcengineering/text'
  import { StyledTextArea } from '@hcengineering/text-editor-resources'
  import {
    Button,
    IconAdd,
    IconDropdown,
    Label,
    Modal,
    ModernEditbox,
    ModernPopup,
    eventToHTMLElement,
    showPopup
  } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'

  export let object: Doc

  const dispatch = createEventDispatcher()
  const client = getClient()
  const me = getCurrentAccount().uuid
  const collaboratorsQuery = createQuery()
  const attachmentsQuery = createQuery()

  let name = ''
  let members: AccountUuid[] = [me]
  let linkedTo: Attachment | undefined = undefined
  let firstMessage: Markup = EmptyMarkup
  let collaborators: AccountUuid[] = []
  let attachments: Attachment[] = []

  $: collaboratorsQuery.query(core.class.Collaborator, { attachedTo: object._id }, (result) => {
    collaborators = result.map(({ collaborator }) => collaborator)
  })

  $: attachmentsQuery.query(attachment.class.Attachment, { attachedTo: object._id }, (result) => {
    attachments = result
  })

  $: missingCollaborators = collaborators.filter((account) => !members.includes(account))
  $: canSave = name.trim().length > 0

  function addAllCollaborators (): void {
    members = [...members, ...missingCollaborators]
  }

  function selectAttachment (ev: MouseEvent): void {
    const items = [
      { id: '', label: chunter.string.NotAttached },
      ...attachments.map((it) => ({ id: it._id, label: getEmbeddedLabel(it.name), icon: attachment.icon.Attachment }))
    ]
    showPopup(ModernPopup, { items, selected: linkedTo?._id ?? '' }, eventToHTMLElement(ev), (result) => {
      if (result == null) return
      linkedTo = attachments.find((it) => it._id === result)
    })
  }

  async function save (): Promise<void> {
    const operations = client.apply(undefined, 'chunter.createObjectDiscussion')
    const discussionId = await operations.addCollection(
      chunter.class.ObjectDiscussion,
      object.space,
      object._id,
      object._class,
      'discussions',
      {
        name: name.trim(),
        resolved: false,
        members: members.includes(me) ? members : [me, ...members],
        linkedTo: linkedTo?._id,
        linkedToClass: linkedTo?._class
      }
    )

    if (!isEmptyMarkup(firstMessage)) {
      await operations.addCollection(
        chunter.class.ChatMessage,
        object.space,
        discussionId,
        chunter.class.ObjectDiscussion,
        'comments',
        { message: firstMessage, attachments: 0 }
      )
    }

    const { result } = await operations.commit()
    if (result) dispatch('close', discussionId)
  }
</script>

<Modal
  label={chunter.string.NewDiscussion}
  type="type-popup"
  okLabel={chunter.string.CreateDiscussion}
  okAction={save}
  {canSave}
  onCancel={() => dispatch('close')}
  on:close
>
  <div class="form">
    <div class="field">
      <span class="field-label"><Label label={chunter.string.Topic} /></span>
      <ModernEditbox bind:value={name} label={chunter.string.Topic} size="medium" autoFocus />
    </div>

    <div class="field">
      <span class="field-label"><Label label={chunter.string.Members} /></span>
      <AccountArrayEditor
        value={members}
        label={chunter.string.Members}
        onChange={(value) => {
          members = value
        }}
        kind="regular"
        size="large"
      />
      {#if missingCollaborators.length > 0}
        <div class="add-all">
          <Button
            kind="link"
            size="small"
            icon={IconAdd}
            label={chunter.string.AddAllCollaborators}
            labelParams={{ count: missingCollaborators.length }}
            on:click={addAllCollaborators}
          />
        </div>
      {/if}
    </div>

    {#if attachments.length > 0}
      <div class="field">
        <span class="field-label"><Label label={chunter.string.AttachTo} /></span>
        <Button
          kind="regular"
          size="large"
          width="100%"
          justify="left"
          icon={attachment.icon.Attachment}
          iconRight={IconDropdown}
          label={linkedTo !== undefined ? getEmbeddedLabel(linkedTo.name) : chunter.string.NotAttached}
          on:click={selectAttachment}
        />
        <span class="hint"><Label label={chunter.string.AttachToDescription} /></span>
      </div>
    {/if}

    <div class="field">
      <span class="field-label"><Label label={chunter.string.FirstMessage} /></span>
      <StyledTextArea
        bind:content={firstMessage}
        placeholder={chunter.string.FirstMessagePlaceholder}
        kind="emphasized"
        showButtons={false}
        maxHeight="8rem"
      />
    </div>
  </div>
</Modal>

<style lang="scss">
  .form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    width: 100%;
    min-width: 34rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .field-label {
    color: var(--global-secondary-TextColor);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .add-all {
    display: flex;
    align-self: flex-start;
  }

  .hint {
    color: var(--global-tertiary-TextColor);
    font-size: 0.75rem;
  }
</style>
