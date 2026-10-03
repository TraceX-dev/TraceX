<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { Card } from '@hcengineering/card'
  import { Class, Ref } from '@hcengineering/core'
  import type { DocumentQuery } from '@hcengineering/core'
  import { IntlString, setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { ActionIcon, Button, ButtonKind, ButtonSize, eventToHTMLElement, Label, showPopup } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { openDoc } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'
  import card from '../plugin'
  import CardPresenter from './CardPresenter.svelte'
  import CardsPopup from './CardsPopup.svelte'

  export let value: Ref<Card> | undefined
  export let readonly: boolean = false
  export let showNavigate: boolean = true
  export let label: IntlString = card.string.Card
  export let _class: Ref<Class<Card>>
  export let ignoreObjects: Ref<Card>[] | undefined = undefined
  export let docQuery: DocumentQuery<Card> = {}

  export let focusIndex: number | undefined = undefined
  export let kind: ButtonKind = 'no-border'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'left'
  export let width: string | undefined = '100%'

  const client = getClient()
  const dispatch = createEventDispatcher()

  const handleOpen = (event: MouseEvent): void => {
    event.stopPropagation()

    if (readonly) {
      return
    }

    showPopup(CardsPopup, { selected: value, _class, ignoreObjects, docQuery }, eventToHTMLElement(event), change)
  }

  const change = (val: Card | undefined): void => {
    if (readonly || val == null || value === val._id) {
      return
    }

    value = val._id
    dispatch('change', value)
    dispatch('value', val)
  }

  let doc: Card | undefined

  const query = createQuery()
  $: if (value !== undefined) {
    query.query(card.class.Card, { _id: value }, (res) => {
      doc = res[0]
    })
  } else {
    query.unsubscribe()
    doc = undefined
  }
</script>

<Button
  showTooltip={!readonly ? { label } : undefined}
  {justify}
  {focusIndex}
  width={width ?? '100%'}
  {size}
  {kind}
  disabled={readonly}
  on:click={handleOpen}
>
  <div slot="content" class="overflow-label flex-row-center w-full" class:flex-between={showNavigate && doc}>
    <div class="overflow-label flex-grow min-w-0 text-left">
      {#if doc}
        <CardPresenter value={doc} type={'text'} />
      {:else}
        <Label {label} />
      {/if}
    </div>
    {#if doc && showNavigate}
      <div class="ml-2 flex-row-center flex-no-shrink">
        <ActionIcon
          icon={view.icon.ArrowRight}
          size={'small'}
          action={() => {
            if (doc) {
              return openDoc(client.getHierarchy(), doc).catch((err) => {
                setPlatformStatus(unknownError(err))
              })
            }
          }}
        />
      </div>
    {/if}
  </div>
</Button>
