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
  import { Employee } from '@hcengineering/contact'
  import core, {
    AccountUuid,
    AnyAttribute,
    ArrOf,
    DocumentQuery,
    notEmpty,
    Ref,
    RefTo,
    Space
  } from '@hcengineering/core'
  import type { ButtonKind, ButtonSize } from '@hcengineering/ui'
  import { IntlString } from '@hcengineering/platform'
  import UserBoxList from './UserBoxList.svelte'
  import { employeeRefByAccountUuidStore, getGuestScopedPersonQuery } from '..'
  import { createReferenceQuery } from '@hcengineering/view-resources'
  import { getClient } from '@hcengineering/presentation'

  export let type: ArrOf<Employee> | undefined = undefined
  export let label: IntlString
  export let value: Ref<Employee>[]
  export let onChange: (refs: Ref<Employee>[]) => void
  export let readonly = false

  export let kind: ButtonKind = 'link'
  export let size: ButtonSize = 'medium'
  export let width: string | undefined = '100%'
  export let justify: 'left' | 'center' = 'left'
  export let attribute: AnyAttribute | undefined = undefined
  export let space: Ref<Space> | undefined = undefined

  let docQuery: DocumentQuery<Employee> = {
    active: true
  }

  const client = getClient()

  let timer: any

  function onUpdate (evt: CustomEvent<Ref<Employee>[]>): void {
    clearTimeout(timer)
    timer = setTimeout(() => {
      onChange(evt.detail)
    }, 500)
  }

  $: referenceType = type?.of as RefTo<Employee> | undefined

  const candidates = createReferenceQuery<Employee>()
  $: candidates.update(referenceType, docQuery)

  $: buildQuery(attribute, space)

  async function buildQuery (attribute: AnyAttribute | undefined, space: Ref<Space> | undefined): Promise<void> {
    // Guests are offered only people of the object's space
    const baseQuery: DocumentQuery<Employee> = {
      active: true,
      ...(await getGuestScopedPersonQuery<Employee>(client, space))
    }
    if (attribute === undefined || space === undefined) {
      docQuery = baseQuery
      return
    }
    if (attribute.spaceMembersOnly === true || attribute.byRole !== undefined) {
      const _space = await client.findOne(core.class.Space, {
        _id: space
      })
      if (_space === undefined) {
        docQuery = baseQuery
        return
      }

      if (attribute.byRole === undefined) {
        const allMembers = _space.members ?? []
        const allPersonsSet = new Set(allMembers.map((p) => $employeeRefByAccountUuidStore.get(p)).filter(notEmpty))

        docQuery = {
          ...baseQuery,
          _id: { $in: Array.from(allPersonsSet) }
        }
      } else {
        const asMixin = client.getHierarchy().as(_space, core.mixin.SpacesTypeData)
        const roleMembers = ((asMixin as any)[attribute.byRole] ?? []) as AccountUuid[]
        const rolePersons = new Set(roleMembers.map((p) => $employeeRefByAccountUuidStore.get(p)).filter(notEmpty))
        docQuery = {
          ...baseQuery,
          _id: { $in: Array.from(rolePersons) }
        }
      }
    }
  }
</script>

<UserBoxList
  items={value}
  {label}
  on:update={onUpdate}
  {kind}
  {size}
  {justify}
  docQuery={$candidates}
  width={kind === 'list' ? undefined : width}
  {readonly}
/>
