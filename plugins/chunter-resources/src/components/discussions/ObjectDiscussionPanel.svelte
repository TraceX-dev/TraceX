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
  import { type ObjectDiscussion } from '@hcengineering/chunter'
  import { type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Component } from '@hcengineering/ui'
  import view from '@hcengineering/view'

  import chunter from '../../plugin'
  import ObjectDiscussionAside from './ObjectDiscussionAside.svelte'

  // A discussion is always shown in the context of its owner (inbox, links): the owner panel
  // is opened with the discussion in its aside.
  export let _id: Ref<ObjectDiscussion>
  export let embedded: boolean = false
  export let allowClose: boolean = true

  const hierarchy = getClient().getHierarchy()
  const query = createQuery()

  let discussion: ObjectDiscussion | undefined = undefined

  $: query.query(chunter.class.ObjectDiscussion, { _id }, (result) => {
    discussion = result[0]
  })

  $: ownerPanel =
    discussion !== undefined && hierarchy.hasClass(discussion.attachedToClass)
      ? hierarchy.classHierarchyMixin(discussion.attachedToClass, view.mixin.ObjectPanel)
      : undefined

  $: initialAside = {
    id: 'aside',
    component: chunter.component.ObjectDiscussionAside,
    props: { discussionId: _id }
  }
</script>

{#if discussion !== undefined}
  {#if ownerPanel !== undefined}
    <Component
      is={ownerPanel.component}
      props={{
        _id: discussion.attachedTo,
        _class: discussion.attachedToClass,
        embedded,
        allowClose,
        initialAside
      }}
      on:close
      on:open
    />
  {:else}
    <ObjectDiscussionAside discussionId={_id} on:close />
  {/if}
{/if}
