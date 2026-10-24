<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
  import core, { Class, Doc, Ref } from '@hcengineering/core'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import { Button, EditBox, eventToHTMLElement, Label, SelectPopup, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import type { SlotModel } from '@hcengineering/process'
  import processPlugin from '../../plugin'
  import { isTypeEqual } from '../../utils'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import card from '@hcengineering/card'
  import { matchesSlotType } from '../../exporter'

  export let requiredSlots: Record<string, SlotModel>
  export let masterTag: Ref<Class<any>>
  export let initialBindings: Record<string, string> = {}

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const model = client.getModel()
  const dispatch = createEventDispatcher()

  let bindings: Record<string, string> = { ...initialBindings }

  $: allAttrs = hierarchy.getAllAttributes(masterTag, core.class.Doc)
  $: allAssociations = model.findAllSync(core.class.Association, {})
  $: allProcesses = model.findAllSync(processPlugin.class.Process, {})

  function isClassLike (obj: Doc | undefined): boolean {
    if (!obj || !obj._class) return false
    return obj._class === core.class.Class || hierarchy.isDerived(obj._class, core.class.Class)
  }

  function resolveMemberOf (
    memberOf: string | undefined,
    currentBindings: Record<string, string>
  ): Ref<Class<Doc>> | undefined {
    if (memberOf === undefined) return masterTag
    let targetId: string | undefined
    if (memberOf.startsWith('__SLOT_')) {
      const parentSlotId = memberOf.replace(/^__SLOT_(.+)__$/, '$1')
      targetId = currentBindings[parentSlotId]
      if (!targetId) {
        const parentObj = model.findObject(parentSlotId as any)
        if (isClassLike(parentObj)) targetId = parentSlotId
      }
    } else {
      targetId = memberOf
    }

    const obj = targetId ? model.findObject(targetId as any) : undefined
    if (isClassLike(obj)) return targetId as Ref<Class<Doc>>
    return undefined
  }

  // Reactive map: recalculated every time `bindings` changes.
  // Each slot gets its resolved memberOf tag and whether it's currently enabled.
  $: resolvedSlots = (() => {
    const result: Record<string, { resolved: Ref<Class<Doc>> | undefined, enabled: boolean }> = {}
    for (const [id, slot] of Object.entries(requiredSlots)) {
      const resolved = resolveMemberOf(slot.memberOf, bindings)
      const enabled = slot.memberOf === undefined || resolved !== undefined
      result[id] = { resolved, enabled }
    }
    return result
  })()

  function setBinding (slotId: string, e: MouseEvent): void {
    const slot = requiredSlots[slotId] as any
    const memberOfTag = resolvedSlots[slotId]?.resolved
    if (!memberOfTag) return

    let possible: Array<{ id: string, label?: any, text?: string }> = []

    if (slot.slotKind === 'association' || slot._class === core.class.Association) {
      possible = allAssociations
        .filter((assoc) => {
          const isA =
            hierarchy.isDerived(masterTag, assoc.classA) &&
            (memberOfTag ? hierarchy.isDerived(memberOfTag, assoc.classB) : false)
          const isB =
            hierarchy.isDerived(masterTag, assoc.classB) &&
            (memberOfTag ? hierarchy.isDerived(memberOfTag, assoc.classA) : false)
          return isA || isB
        })
        .map((a) => ({
          id: a._id,
          text: hierarchy.isDerived(a.classA, masterTag) ? a.nameA + ' -> ' + a.nameB : a.nameB + ' -> ' + a.nameA
        }))
    } else if (slot.slotKind === 'process' || slot._class === processPlugin.class.Process) {
      possible = allProcesses
        .filter((proc) => !memberOfTag || hierarchy.isDerived(memberOfTag, proc.masterTag))
        .map((p) => ({
          id: p._id,
          label: (p as any).label,
          text: p.name ?? p._id
        }))
    } else if (slot.slotKind === 'class' || isClassLike({ _class: slot._class } as any)) {
      let descendants: Ref<Class<Doc>>[] = []
      try {
        if (slot._class === card.class.Tag) {
          descendants = hierarchy.getAllPossibleMixins(masterTag)
        } else {
          descendants = hierarchy.getDescendants(core.class.Obj)
        }
      } catch (e) {}

      const expectedClass = slot._class || core.class.Class
      possible = descendants
        .map((id) => model.findObject(id as any))
        .filter((c) => {
          if (!c || (c as any).hidden) return false
          const cClass = c._class
          return cClass === expectedClass || hierarchy.isDerived(cClass, expectedClass)
        })
        .map((c: any) => ({
          id: c._id,
          label: c.label,
          text: c.name ?? c._id
        }))
    } else {
      const attributes = memberOfTag ? hierarchy.getAllAttributes(memberOfTag, core.class.Doc) : []
      possible = Array.from(attributes.values())
        .filter(
          (attr) =>
            !attr.hidden &&
            (slot.enumValues !== undefined
              ? matchesSlotType(slot.type, attr.type, slot.enumValues, model)
              : isTypeEqual(slot, attr.type, bindings))
        )
        .map((a) => ({
          id: a.name,
          label: a.label,
          text: a.name
        }))
    }

    showPopup(
      SelectPopup,
      {
        value: possible.map((p) => ({ id: p.id, label: p.label, text: p.label ? undefined : p.text })),
        searchable: true
      },
      eventToHTMLElement(e),
      (res) => {
        if (res != null) {
          // Clear dependent bindings when a parent slot changes
          updateBinding(slotId, res as string)
        }
      }
    )
  }

  function updateBinding (slotId: string, value: string): void {
    const next = { ...bindings }
    const cleared = new Set([slotId])
    let changed = true
    while (changed) {
      changed = false
      for (const [key, slot] of Object.entries(requiredSlots)) {
        const parent = slot.memberOf?.replace(/^__SLOT_(.+)__$/, '$1')
        if (parent !== undefined && cleared.has(parent) && !cleared.has(key)) {
          cleared.add(key)
          changed = true
        }
      }
    }
    for (const key of cleared) delete next[key]
    if (value.trim() !== '') next[slotId] = value.trim()
    bindings = next
  }

  function onSave (): void {
    dispatch('close', bindings)
  }

  $: allBound = Object.keys(requiredSlots).every((id) => bindings[id]?.trim() && resolvedSlots[id]?.enabled)

  function getBindingLabel (currentBindings: Record<string, string>, id: string): any {
    const value = currentBindings[id]
    if (value === undefined) return presentation.string.NotSelected

    // Search in the resolved memberOf tag's attributes first, then fallback to masterTag
    const slot = requiredSlots[id]
    const memberOfTag = slot?.memberOf !== undefined ? resolveMemberOf(slot.memberOf, currentBindings) : masterTag
    const searchTag = memberOfTag ?? masterTag

    try {
      const attrs = hierarchy.getAllAttributes(searchTag, core.class.Doc)
      const attr = Array.from(attrs.values()).find((a) => a.name === value)
      if (attr) return attr.label ?? attr.name
    } catch (e) {
      // Tag may not be in hierarchy yet
    }

    // Also search masterTag if different
    if (searchTag !== masterTag) {
      try {
        const masterAttrs = hierarchy.getAllAttributes(masterTag, core.class.Doc)
        const attr = Array.from(masterAttrs.values()).find((a) => a.name === value)
        if (attr !== undefined) return attr.label ?? attr.name
      } catch (e) {}
    }

    const assoc = allAssociations.find((a) => a._id === value)
    if (assoc !== undefined) {
      return hierarchy.isDerived(assoc.classA, masterTag)
        ? getEmbeddedLabel(assoc.nameA + ' -> ' + assoc.nameB)
        : getEmbeddedLabel(assoc.nameB + ' -> ' + assoc.nameA)
    }

    const proc = allProcesses.find((p) => p._id === value)
    if (proc !== undefined) return getEmbeddedLabel(proc.name)

    const cls = model.findObject(value as any)
    if (isClassLike(cls)) return (cls as any).label ?? (cls as any).name

    return value
  }
</script>

<Card
  label={processPlugin.string.RequiredSlots}
  canSave={allBound}
  width="small"
  okLabel={processPlugin.string.Import}
  okAction={onSave}
  on:close
>
  <div class="flex-column flex-gap-4">
    {#each Object.entries(requiredSlots) as [id, slot]}
      <div class="flex-column flex-gap-1">
        {#if slot.label}
          <Label label={slot.label} />
        {:else}
          {slot.name ?? id}
        {/if}
        {#if slot.slotKind === 'unknown'}
          <EditBox
            value={bindings[id]}
            label={slot.label ?? getEmbeddedLabel(slot.name ?? id)}
            disabled={!resolvedSlots[id]?.enabled}
            on:value={(event) => updateBinding(id, String(event.detail ?? ''))}
          />
        {:else}
          <Button
            label={getBindingLabel(bindings, id)}
            disabled={!resolvedSlots[id]?.enabled}
            kind="secondary"
            width="100%"
            on:click={(e) => {
              setBinding(id, e)
            }}
          />
        {/if}
      </div>
    {/each}
  </div>
</Card>
