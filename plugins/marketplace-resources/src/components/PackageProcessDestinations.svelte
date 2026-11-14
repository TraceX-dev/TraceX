<!--
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import card, { type MasterTag } from '@hcengineering/card'
  import type { Ref } from '@hcengineering/core'
  import { getDefinitionPackageProcessSlots, type DefinitionPackageDestination } from '@hcengineering/marketplace'
  import type { IntlString } from '@hcengineering/platform'
  import presentation, { getClient } from '@hcengineering/presentation'
  import process, { type Process } from '@hcengineering/process'
  import { Button, SelectPopup, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import ImportSlotsPopup from './ImportSlotsPopup.svelte'

  export let members: Process[]
  export let destinations: Record<string, DefinitionPackageDestination> = {}
  export let busy = false

  const client = getClient()
  const dispatch = createEventDispatcher<{ change: Record<string, DefinitionPackageDestination> }>()

  function change (id: string, value: DefinitionPackageDestination): void {
    destinations = { ...destinations, [id]: value }
    dispatch('change', destinations)
  }

  function destinationLabel (id: string): IntlString {
    const target = destinations[id]
    return target === undefined
      ? presentation.string.NotSelected
      : (client.getModel().findObject<MasterTag>(target.masterTag)?.label ?? presentation.string.NotSelected)
  }

  function selectDestination (member: Process, event: MouseEvent): void {
    const model = client.getModel()
    const types = [...model.findAllSync(card.class.MasterTag, {}), ...model.findAllSync(card.class.Tag, {})]
    showPopup(
      SelectPopup,
      {
        value: types.filter((type) => !type.hidden).map((type) => ({ id: type._id, label: type.label })),
        searchable: true
      },
      eventToHTMLElement(event),
      (value: Ref<MasterTag> | undefined) => {
        if (value != null && value !== destinations[member._id]?.masterTag) {
          change(member._id, { masterTag: value, bindings: {} })
        }
      }
    )
  }

  function configureBindings (member: Process): void {
    const target = destinations[member._id]
    if (target === undefined) return
    showPopup(
      ImportSlotsPopup,
      {
        masterTag: target.masterTag,
        requiredSlots: getDefinitionPackageProcessSlots(member, members),
        initialBindings: target.bindings
      },
      'centered',
      (bindings: Record<string, string> | undefined) => {
        if (bindings != null) change(member._id, { ...target, bindings })
      }
    )
  }
</script>

{#each members as member (member._id)}
  <div class="destination flex-col flex-gap-3" data-id="package-process-destination">
    <span class="font-medium">{member.name}</span>
    <Button
      kind="secondary"
      label={destinationLabel(member._id)}
      disabled={busy}
      on:click={(event) => selectDestination(member, event)}
    />
    {#if Object.keys(getDefinitionPackageProcessSlots(member, members)).length > 0}
      <Button
        kind="secondary"
        label={process.string.RequiredSlots}
        disabled={busy || destinations[member._id] === undefined}
        on:click={() => configureBindings(member)}
      />
    {/if}
  </div>
{/each}

<style lang="scss">
  .destination {
    padding: var(--spacing-3);
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--spacing-1);
  }
</style>
