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
-->
<script lang="ts">
  import { type Discussion, withDiscussionVisibility } from '@hcengineering/chunter'
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import core, {
    type AccountUuid,
    type AttachedData,
    type Doc,
    getCurrentAccount,
    type Markup,
    type ObjectVisibility
  } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { EmptyMarkup, isEmptyMarkup } from '@hcengineering/text'
  import { StyledTextArea } from '@hcengineering/text-editor-resources'
  import { Button, IconAdd, Label, Modal, ModernEditbox } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'
  import { ensureCollaborator } from '../../utils'
  import DiscussionVisibilityMenu from './DiscussionVisibilityMenu.svelte'

  export let object: Doc

  const dispatch = createEventDispatcher()
  const client = getClient()
  const me = getCurrentAccount().uuid
  const collaboratorsQuery = createQuery()

  let name = ''
  let members: AccountUuid[] = [me]
  let visibility: ObjectVisibility = 'public'
  // StyledTextArea updates its bound content only on blur.
  let draftMessage: Markup = EmptyMarkup
  let collaborators: AccountUuid[] = []
  let saving = false

  $: collaboratorsQuery.query(core.class.Collaborator, { attachedTo: object._id }, (result) => {
    collaborators = result.map(({ collaborator }) => collaborator)
  })

  $: missingCollaborators = collaborators.filter((account) => !members.includes(account))

  function addAllCollaborators (): void {
    members = [...members, ...missingCollaborators]
  }

  async function save (): Promise<void> {
    if (saving) return
    saving = true
    try {
      await create()
    } finally {
      saving = false
    }
  }

  async function create (): Promise<void> {
    const operations = client.apply(undefined, 'chunter.createDiscussion')
    const title = name.trim()
    const data: AttachedData<Discussion> = {
      ...(title !== '' ? { name: title } : {}),
      resolved: false,
      // Members exist only for a private discussion.
      members: visibility !== 'private' ? [] : members.includes(me) ? members : [me, ...members]
    }
    // The creator must be a card collaborator to keep access.
    if (visibility === 'participants') {
      await ensureCollaborator(operations, object)
    }
    const discussionId = await operations.addCollection(
      chunter.class.Discussion,
      object.space,
      object._id,
      object._class,
      'discussions',
      withDiscussionVisibility(data, visibility)
    )

    if (!isEmptyMarkup(draftMessage)) {
      await operations.addCollection(
        chunter.class.ChatMessage,
        object.space,
        discussionId,
        chunter.class.Discussion,
        'comments',
        { message: draftMessage, attachments: 0 }
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
  okLoading={saving}
  canSave={!saving}
  onCancel={() => dispatch('close')}
  on:close
>
  <div class="form">
    <div class="field">
      <span class="field-label"><Label label={chunter.string.DiscussionTitleOptional} /></span>
      <ModernEditbox bind:value={name} label={chunter.string.Topic} size="medium" autoFocus />
    </div>

    <div class="field">
      <span class="field-label"><Label label={chunter.string.Visibility} /></span>
      <div class="visibility">
        <DiscussionVisibilityMenu
          value={visibility}
          parentClass={object._class}
          on:change={(ev) => {
            visibility = ev.detail
          }}
        />
      </div>
    </div>

    {#if visibility === 'private'}
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
    {/if}

    <div class="field">
      <span class="field-label"><Label label={chunter.string.FirstMessage} /></span>
      <StyledTextArea
        content={EmptyMarkup}
        on:changeContent={(ev) => {
          draftMessage = ev.detail
        }}
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

  .add-all,
  .visibility {
    display: flex;
    align-self: flex-start;
  }
</style>
