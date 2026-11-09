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
//

-->
<script lang="ts">
  import contact, { Contact } from '@hcengineering/contact'
  import { ArrOf, Ref, RefTo, getReferenceQuery } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { IntlString } from '@hcengineering/platform'
  import { ButtonKind } from '@hcengineering/ui'
  import ContactList from './ContactList.svelte'

  export let label: IntlString
  export let value: Ref<Contact>[]
  export let type: ArrOf<Ref<Contact>> | undefined
  export let onChange: (refs: Ref<Contact>[]) => void
  export let readonly = false
  export let kind: ButtonKind = 'link'

  const client = getClient()
  $: referenceType = type?.of as RefTo<Contact> | undefined
  $: candidatesQuery = referenceType?.to === contact.class.Person
    ? getReferenceQuery(client.getHierarchy(), referenceType)
    : undefined
  $: _clazz = (type?.of as RefTo<Contact>)?.to
  let timer: any

  function onUpdate (evt: CustomEvent<Ref<Contact>[]>): void {
    clearTimeout(timer)
    timer = setTimeout(() => {
      onChange(evt.detail)
    }, 500)
  }
</script>

<ContactList
  items={value}
  {label}
  _class={_clazz}
  docQuery={candidatesQuery}
  on:update={onUpdate}
  {kind}
  size={'medium'}
  justify={'left'}
  width={kind === 'list' ? undefined : '100%'}
  {readonly}
/>
