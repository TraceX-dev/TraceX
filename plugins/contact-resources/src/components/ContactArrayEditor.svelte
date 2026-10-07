<script lang="ts">
  import { Contact, type PeopleScopeInput } from '@hcengineering/contact'
  import { ArrOf, Doc, Ref, RefTo, Space } from '@hcengineering/core'
  import { IntlString } from '@hcengineering/platform'
  import { ButtonKind } from '@hcengineering/ui'
  import ContactList from './ContactList.svelte'
  import { getEditorPeopleScope } from '../guestPeopleFilter'

  export let label: IntlString
  export let value: Ref<Contact>[]
  export let type: ArrOf<RefTo<Doc>> | undefined
  export let onChange: (refs: Ref<Contact>[]) => void
  export let readonly = false
  export let kind: ButtonKind = 'link'
  // Guests are offered only people of this scope (by default: the edited object), see `PeopleScopeInput`
  export let peopleScope: PeopleScopeInput = undefined
  export let space: Ref<Space> | undefined = undefined
  export let object: Doc | undefined = undefined

  $: _clazz = (type?.of as RefTo<Doc>)?.to
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
  peopleScope={getEditorPeopleScope(peopleScope, space, object)}
  on:update={onUpdate}
  {kind}
  size={'medium'}
  justify={'left'}
  width={kind === 'list' ? undefined : '100%'}
  {readonly}
/>
