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
  import { type DiscussionVisibility } from '@hcengineering/chunter'
  import contact from '@hcengineering/contact'
  import { type Class, type Doc, type Ref } from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import { ButtonMenu, type DropdownIntlItem, languageStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import chunter from '../../plugin'

  export let value: DiscussionVisibility
  export let parentClass: Ref<Class<Doc>>
  export let kind: 'secondary' | 'tertiary' = 'secondary'
  export let size: 'medium' | 'small' = 'medium'
  // Shows only the icon, with the current level in the tooltip.
  export let iconOnly: boolean = false

  const dispatch = createEventDispatcher<{ change: DiscussionVisibility }>()
  const hierarchy = getClient().getHierarchy()

  let parentLabel = ''
  $: void updateParentLabel(parentClass, $languageStore)

  async function updateParentLabel (_class: Ref<Class<Doc>>, language: string): Promise<void> {
    parentLabel = await translate(hierarchy.getClass(_class).label, {}, language)
  }

  let items: DropdownIntlItem[] = []
  $: items = [
    {
      id: 'public',
      icon: chunter.icon.Hashtag,
      label: chunter.string.VisibilitySpace,
      description: chunter.string.VisibilitySpaceDescription
    },
    {
      id: 'participants',
      icon: contact.icon.ComponentMembers,
      label: chunter.string.VisibilityParticipants,
      params: { label: parentLabel },
      description: chunter.string.VisibilityParticipantsDescription
    }
  ]

  $: current = items.find((it) => it.id === value) ?? items[0]

  function handleSelected (event: CustomEvent<DropdownIntlItem['id']>): void {
    dispatch('change', event.detail as DiscussionVisibility)
  }
</script>

<ButtonMenu
  {items}
  selected={value}
  icon={current.icon}
  label={iconOnly ? undefined : current.label}
  labelParams={current.params ?? {}}
  tooltip={iconOnly ? { label: current.label, props: current.params ?? {} } : undefined}
  {kind}
  {size}
  dataId="discussionVisibility"
  on:selected={handleSelected}
/>
