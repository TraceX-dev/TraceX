<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import contact, { Employee } from '@hcengineering/contact'
  import { AnyAttribute, Doc, Ref } from '@hcengineering/core'
  import { IntlString, translateCB } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import type { ButtonKind, ButtonSize } from '@hcengineering/ui'
  import { Button, eventToHTMLElement, showPopup, themeStore } from '@hcengineering/ui'
  import { permissions } from '@hcengineering/view-resources'
  import UsersPopup from './UsersPopup.svelte'

  export let value: Doc
  export let kind: ButtonKind = 'no-border'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'center'
  export let width: string | undefined = 'min-content'
  export let intlTitle: IntlString
  export let intlSearchPh: IntlString
  export let retrieveMembers: (doc: Doc) => Ref<Employee>[]
  export let attribute: AnyAttribute | undefined = undefined
  export let shouldShowLabel: boolean = true

  const client = getClient()

  let buttonTitle = ''

  $: members = retrieveMembers(value)
  $: canEditMembers = $permissions.canEditMembers(value, attribute)
  $: translateCB(intlTitle, {}, $themeStore.language, (res) => {
    buttonTitle = res
  })

  const handleMembersChanged = async (result: Ref<Employee>[] | undefined) => {
    if (result === undefined || !canEditMembers) {
      return
    }

    const memberToPull = members.filter((x) => !result.includes(x))[0]
    const memberToPush = result.filter((x) => !members.includes(x))[0]

    if (memberToPull) {
      await client.update(value, { $pull: { members: memberToPull } })
    }

    if (memberToPush) {
      await client.update(value, { $push: { members: memberToPush } })
    }
  }

  const handleMembersEditorOpened = async (event: MouseEvent) => {
    if (!canEditMembers) return

    showPopup(
      UsersPopup,
      {
        _class: contact.mixin.Employee,
        selectedUsers: members,
        allowDeselect: true,
        multiSelect: true,
        docQuery: {
          active: true
        },
        placeholder: intlSearchPh
      },
      eventToHTMLElement(event),
      undefined,
      handleMembersChanged
    )
  }
</script>

<Button
  {kind}
  {size}
  {width}
  {justify}
  label={shouldShowLabel ? contact.string.NumberMembers : undefined}
  labelParams={shouldShowLabel ? { count: members.length } : {}}
  title={buttonTitle}
  icon={contact.icon.ComponentMembers}
  disabled={!canEditMembers}
  on:click={handleMembersEditorOpened}
/>
