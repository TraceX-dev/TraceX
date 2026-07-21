<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
  import core, { type Class, type Doc, type Ref } from '@hcengineering/core'
  import integration, { type IntegrationSlotBinding, type IntegrationSlotProvider } from '@hcengineering/integration'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import { Button, eventToHTMLElement, Label, SelectPopup, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import { getBindingLabel, getPossibleAttributes, getPossibleClasses } from '../utils'

  export let provider: IntegrationSlotProvider
  export let targetClass: Ref<Class<Doc>>
  export let binding: IntegrationSlotBinding | undefined = undefined

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const dispatch = createEventDispatcher()

  const requiredSlotIds = Object.keys(provider.requiredSlots)
  const optionalSlotIds = Object.keys(provider.optionalSlots ?? {})

  let allAttrs = hierarchy.getAllAttributes(targetClass, core.class.Doc)
  let bindings: Record<string, string> = filterBindingsForTargetClass({ ...(binding?.bindings ?? {}) })
  let allBound = isAllBound()

  function setTargetClass (nextTargetClass: Ref<Class<Doc>>): void {
    targetClass = nextTargetClass
    allAttrs = hierarchy.getAllAttributes(targetClass, core.class.Doc)
    bindings = filterBindingsForTargetClass(bindings)
    refresh()
  }

  function refresh (): void {
    allBound = isAllBound()
  }

  function setBinding (slotId: string, e: MouseEvent): void {
    const slot = provider.requiredSlots[slotId] ?? provider.optionalSlots?.[slotId]
    if (slot === undefined) return

    const possible =
      slot.slotKind === 'class' ? getPossibleClasses(client, slot) : getPossibleAttributes(client, allAttrs, slot)

    showPopup(
      SelectPopup,
      {
        value: possible.map((p) => ({ id: p.id, label: p.label, text: p.label ? undefined : p.text })),
        searchable: true
      },
      eventToHTMLElement(e),
      (res) => {
        if (res != null) {
          bindings = { ...bindings, [slotId]: res as string }
          refresh()
        }
      }
    )
  }

  function onSave (): void {
    dispatch('close', bindings)
  }

  function filterBindingsForTargetClass (currentBindings: Record<string, string>): Record<string, string> {
    const nextBindings: Record<string, string> = {}
    for (const [slotId, value] of Object.entries(currentBindings)) {
      const slot = provider.requiredSlots[slotId] ?? provider.optionalSlots?.[slotId]
      if (slot?.slotKind === 'class' || allAttrs.has(value)) {
        nextBindings[slotId] = value
      }
    }
    return nextBindings
  }

  function isAllBound (): boolean {
    return requiredSlotIds.every((id) => bindings[id] !== undefined)
  }

  export function updateTargetClass (nextTargetClass: Ref<Class<Doc>>): void {
    setTargetClass(nextTargetClass)
  }
</script>

<Card
  label={integration.string.IntegrationSlotBinding}
  canSave={allBound}
  width="small"
  okLabel={presentation.string.Save}
  okAction={onSave}
  on:close
>
  <div class="flex-column flex-gap-4">
    {#each Object.entries(provider.requiredSlots) as [id, slot]}
      <div class="flex-column flex-gap-1">
        <Label label={slot.label ?? getEmbeddedLabel(slot.name ?? id)} />
        <Button
          label={getBindingLabel(client, allAttrs, bindings, id)}
          kind="secondary"
          width="100%"
          on:click={(e) => {
            setBinding(id, e)
          }}
        />
      </div>
    {/each}

    {#if optionalSlotIds.length > 0}
      <div class="ap-space x1" />
      {#each optionalSlotIds as id}
        {@const slot = provider.optionalSlots?.[id]}
        {#if slot !== undefined}
          <div class="flex-column flex-gap-1">
            <Label label={slot.label ?? getEmbeddedLabel(slot.name ?? id)} />
            <Button
              label={getBindingLabel(client, allAttrs, bindings, id)}
              kind="secondary"
              width="100%"
              on:click={(e) => {
                setBinding(id, e)
              }}
            />
          </div>
        {/if}
      {/each}
    {/if}

    {#if requiredSlotIds.length === 0 && optionalSlotIds.length === 0}
      <div class="opacity-40 text-center py-4">No slots defined for this provider</div>
    {/if}
  </div>
</Card>
