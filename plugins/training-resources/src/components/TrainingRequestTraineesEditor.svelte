<!--
//
// Copyright © 2024 Hardcore Engineering Inc.
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
  import { Employee, type PeopleScopeInput } from '@hcengineering/contact'
  import { Doc, Ref, Space } from '@hcengineering/core'
  import { IntlString } from '@hcengineering/platform'
  import type { ButtonKind, ButtonSize } from '@hcengineering/ui'
  import { getEditorPeopleScope, UserBoxList } from '@hcengineering/contact-resources'
  import training from '../plugin'

  export let value: Ref<Employee>[]
  export let onChange: (refs: Ref<Employee>[]) => void
  export let readonly = false
  export let label: IntlString | undefined = undefined
  export let emptyLabel: IntlString = training.string.TrainingRequestTrainees

  export let kind: ButtonKind = 'link'
  export let size: ButtonSize = 'medium'
  export let width: string | undefined = 'max-content'
  export let justify: 'left' | 'center' = 'left'
  // Guests are offered only people of this scope (by default: the edited object), see `PeopleScopeInput`
  export let peopleScope: PeopleScopeInput = undefined
  export let space: Ref<Space> | undefined = undefined
  export let object: Doc | undefined = undefined
</script>

<UserBoxList
  items={value}
  {label}
  {emptyLabel}
  on:update={(event) => {
    onChange(event.detail)
  }}
  {kind}
  {size}
  {justify}
  {width}
  {readonly}
  peopleScope={getEditorPeopleScope(peopleScope, space, object)}
/>
