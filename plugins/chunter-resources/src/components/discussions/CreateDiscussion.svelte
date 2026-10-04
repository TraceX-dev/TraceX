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
  import { type DiscussionVisibility, makeDiscussionExcerpt } from '@hcengineering/chunter'
  import { type Doc, type Markup } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { EmptyMarkup, isEmptyMarkup, markupToText } from '@hcengineering/text'
  import { StyledTextArea } from '@hcengineering/text-editor-resources'
  import { Label, Modal, ModernEditbox } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'
  import { ensureParentCollaborator } from '../../utils'
  import DiscussionVisibilityMenu from './DiscussionVisibilityMenu.svelte'

  export let object: Doc

  const dispatch = createEventDispatcher()
  const client = getClient()

  let name = ''
  let visibility: DiscussionVisibility = 'public'
  // StyledTextArea updates its bound content only on blur.
  let draftMessage: Markup = EmptyMarkup

  async function save (): Promise<void> {
    const operations = client.apply(undefined, 'chunter.createDiscussion')
    const title = name.trim()
    const excerpt = isEmptyMarkup(draftMessage) ? '' : makeDiscussionExcerpt(markupToText(draftMessage))
    const space = object.space

    if (visibility === 'participants') {
      await ensureParentCollaborator(operations, object)
    }

    const discussionId = await operations.addCollection(
      chunter.class.Discussion,
      space,
      object._id,
      object._class,
      'discussions',
      {
        ...(title !== '' ? { name: title } : {}),
        ...(excerpt !== '' ? { excerpt } : {}),
        resolved: false,
        members: [],
        visibility
      }
    )

    if (!isEmptyMarkup(draftMessage)) {
      await operations.addCollection(
        chunter.class.ChatMessage,
        space,
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
  canSave
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

  .visibility {
    display: flex;
    align-self: flex-start;
  }
</style>
