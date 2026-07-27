<!--
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
-->
<!--
  Change-control card picker for the "Create product version" dialog.

  Reads the class-level change-control associations configured for product versions and, for
  each, lets the user attach eligible cards (restricted by the association's card type + filter +
  latest version). The selection is emitted to the dialog, which turns it into `Relation` docs on
  the newly created version.
-->
<script lang="ts">
  import { type Association, type Ref } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { type Card } from '@hcengineering/card'
  import { Button, IconAdd, IconClose, Label, showPopup } from '@hcengineering/ui'
  import { getClient } from '@hcengineering/presentation'
  import { ObjectBox, ObjectBoxPopup } from '@hcengineering/view-resources'

  import products from '../../plugin'
  import { buildCardRelationQuery, getChangeControlAssociations } from '../../changeControl'

  export let selection: Array<{ association: Ref<Association>, card: Ref<Card> }> = []
  export let configured: boolean = false
  export let readonly: boolean = false

  const hierarchy = getClient().getHierarchy()
  const associations = getChangeControlAssociations()
  $: configured = associations.length > 0

  // Reactive map assocId → selected cards, so added/removed cards re-render immediately
  // (referencing `selection` directly, unlike a function call inside an each-block).
  $: cardsByAssoc = new Map<Ref<Association>, Array<Ref<Card>>>(
    associations.map((a) => [a._id, selection.filter((s) => s.association === a._id).map((s) => s.card)])
  )

  function typeLabel (a: Association): IntlString {
    try {
      return hierarchy.getClass(a.classB).label ?? products.string.ChangeControl
    } catch {
      return products.string.ChangeControl
    }
  }

  async function addCard (a: Association): Promise<void> {
    const docQuery = await buildCardRelationQuery(a, cardsByAssoc.get(a._id) ?? [])
    showPopup(
      ObjectBoxPopup,
      { _class: a.classB, docQuery, docProps: { shouldShowAvatar: true } },
      'top',
      (result: any) => {
        if (result != null) {
          selection = [...selection, { association: a._id, card: result._id }]
        }
      }
    )
  }

  function removeCard (a: Association, cardRef: Ref<Card>): void {
    selection = selection.filter((s) => !(s.association === a._id && s.card === cardRef))
  }
</script>

{#if associations.length > 0}
  <div class="flex-col flex-gap-2 w-full">
    {#each associations as a (a._id)}
      <div class="flex-row-center flex-gap-2 flex-wrap">
        <span class="content-dark-color text-sm">
          <Label label={typeLabel(a)} />
        </span>

        {#each cardsByAssoc.get(a._id) ?? [] as c (c)}
          <div class="flex-row-center flex-gap-1">
            <ObjectBox value={c} _class={a.classB} readonly kind={'regular'} size={'small'} showNavigate={false} />
            {#if !readonly}
              <Button
                icon={IconClose}
                kind={'ghost'}
                size={'small'}
                on:click={() => {
                  removeCard(a, c)
                }}
              />
            {/if}
          </div>
        {/each}

        {#if !readonly}
          <Button
            icon={IconAdd}
            label={products.string.AddCard}
            kind={'regular'}
            size={'small'}
            on:click={() => {
              void addCard(a)
            }}
          />
        {/if}
      </div>
    {/each}
  </div>
{/if}
