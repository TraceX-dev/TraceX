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
  import card, { type CardSpace } from '@hcengineering/card'
  import core, { type AnyAttribute, getCurrentAccount, type Ref } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { SpaceSelector } from '@hcengineering/presentation'
  import { type ButtonKind, type ButtonSize } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  export let value: Ref<CardSpace> | undefined
  export let readonly: boolean = false
  export let label: IntlString = core.string.Space
  export let onChange: (value: Ref<CardSpace> | undefined) => void
  export let attribute: AnyAttribute | undefined = undefined

  export let focus: boolean = true
  export let kind: ButtonKind = 'no-border'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'left'
  export let width: string | undefined = 'min-content'

  const dispatch = createEventDispatcher()

  function change (space: Ref<CardSpace> | undefined): void {
    value = space
    dispatch('change', space)
    onChange(space)
  }
</script>

<SpaceSelector
  space={value}
  _class={card.class.CardSpace}
  query={{ archived: false, members: getCurrentAccount().uuid }}
  {label}
  {focus}
  {kind}
  {size}
  {justify}
  {width}
  readonly={readonly || attribute?.readonly === true}
  allowDeselect
  autoSelect={false}
  on:change={(event) => {
    change(event.detail)
  }}
/>
