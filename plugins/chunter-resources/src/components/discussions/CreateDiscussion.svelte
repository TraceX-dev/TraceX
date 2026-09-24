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
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import core, { type AccountUuid, type Doc, getCurrentAccount, type Markup } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { EmptyMarkup, isEmptyMarkup } from '@hcengineering/text'
  import { StyledTextArea } from '@hcengineering/text-editor-resources'
  import { Button, IconAdd, Label, Modal, ModernEditbox } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'

  export let object: Doc

  const dispatch = createEventDispatcher()
  const client = getClient()
  const me = getCurrentAccount().uuid
  const collaboratorsQuery = createQuery()

  let name = ''
  let members: AccountUuid[] = [me]
  let firstMessage: Markup = EmptyMarkup
  let collaborators: AccountUuid[] = []

  $: collaboratorsQuery.query(core.class.Collaborator, { attachedTo: object._id }, (result) => {
    collaborators = result.map(({ collaborator }) => collaborator)
  })

  $: missingCollaborators = collaborators.filter((account) => !members.includes(account))
  $: canSave = name.trim().length > 0

  function addAllCollaborators (): void {
    members = [...members, ...missingCollaborators]
  }

  async function save (): Promise<void> {
    const operations = client.apply(undefined, 'chunter.createDiscussion')
    const discussionId = await operations.addCollection(
      chunter.class.Discussion,
      object.space,
      object._id,
      object._class,
      'discussions',
      {
        name: name.trim(),
        resolved: false,
        members: members.includes(me) ? members : [me, ...members]
      }
    )

    if (!isEmptyMarkup(firstMessage)) {
      await operations.addCollection(
        chunter.class.ChatMessage,
        object.space,
        discussionId,
        chunter.class.Discussion,
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
</style>
