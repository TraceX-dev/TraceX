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
  import core, { type Class, type Doc, type Ref, type Space } from '@hcengineering/core'
  import integration, {
    type IntegrationRoutingPolicy,
    type IntegrationRoutingTarget,
    type IntegrationSlotBinding,
    type IntegrationSlotModel,
    type IntegrationSlotProvider,
    type IntegrationValueMapping,
    type IntegrationValueMappingMode,
    type IntegrationValueOption
  } from '@hcengineering/integration'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import presentation, { Card, getClient, SpaceSelect } from '@hcengineering/presentation'
  import { Button, eventToHTMLElement, Label, SelectPopup, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import {
    getAllowedSpaceClasses,
    getBindingLabel,
    getPossibleAttributes,
    getPossibleClasses,
    getTargetAttributeValueOptions,
    getTargetClassLabel,
    getTargetClassOptions
  } from '../utils'

  interface SlotViewModel {
    id: string
    label: ReturnType<typeof getEmbeddedLabel>
    bindingLabel: ReturnType<typeof getEmbeddedLabel>
    canMapValues: boolean
    mappingExpanded: boolean
    mappingMode: IntegrationValueMappingMode
    valueRows: Array<{
      value: string
      label: ReturnType<typeof getEmbeddedLabel>
      mappedLabel: ReturnType<typeof getEmbeddedLabel>
    }>
  }

  export let provider: IntegrationSlotProvider
  export let binding: IntegrationSlotBinding | undefined = undefined
  export let routingPolicy: IntegrationRoutingPolicy | undefined = undefined
  export let targetClass: Ref<Class<Doc>> | undefined = undefined
  export let space: Ref<Space> | undefined = undefined
  export let targetClasses: Array<Ref<Class<Doc>>> | undefined = undefined

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const dispatch = createEventDispatcher()

  let selectedTargetClass: Ref<Class<Doc>> | undefined =
    targetClass ?? binding?.targetClass ?? routingPolicy?.fallback?.targetClass
  let fallbackSpace: Ref<Space> | undefined = space ?? routingPolicy?.fallback?.space
  let bindings: Record<string, string> = { ...(binding?.bindings ?? {}) }
  let valueMappings: Record<string, IntegrationValueMapping> = { ...(binding?.valueMappings ?? {}) }
  let expandedMappings: Record<string, boolean> = {}
  let allowedSpaceClasses: Array<Ref<Class<Space>>> = []
  let allowedSpaceClassesRequest = 0
  let allowedSpaceClassesLoading = false
  let allAttrs: ReturnType<typeof hierarchy.getAllAttributes> =
    selectedTargetClass !== undefined ? hierarchy.getAllAttributes(selectedTargetClass, core.class.Doc) : new Map()
  const targetClassOptions = getTargetClassOptions(client, targetClasses)
  const requiredSlotIds = Object.keys(provider.requiredSlots)
  const optionalSlotIds = Object.keys(provider.optionalSlots ?? {})
  let allBound = false
  let selectedTargetClassLabel: typeof presentation.string.NotSelected | ReturnType<typeof getTargetClassLabel> =
    presentation.string.NotSelected
  let allowedSpaceClassesKey = ''
  let spaceSelectClass: Ref<Class<Space>> = core.class.Space
  let spaceQuery: { archived: boolean, _class?: { $in: Array<Ref<Class<Space>>> } } = { archived: false }
  let requiredSlotRows: SlotViewModel[] = []
  let optionalSlotRows: SlotViewModel[] = []

  function selectTargetClass (e: MouseEvent): void {
    showPopup(
      SelectPopup,
      {
        value: targetClassOptions.map((p) => ({ id: p.id, label: p.label, text: p.label ? undefined : p.text })),
        searchable: true
      },
      eventToHTMLElement(e),
      (res) => {
        if (res != null) {
          setSelectedTargetClass(res as Ref<Class<Doc>>)
        }
      }
    )
  }

  async function loadAllowedSpaceClasses (targetClass: Ref<Class<Doc>> | undefined): Promise<void> {
    const request = ++allowedSpaceClassesRequest
    allowedSpaceClassesLoading = targetClass !== undefined
    refreshViewModel()
    const result = await getAllowedSpaceClasses(client, targetClass)
    if (request === allowedSpaceClassesRequest && selectedTargetClass === targetClass) {
      allowedSpaceClasses = result
      allowedSpaceClassesLoading = false
      refreshViewModel()
    }
  }

  function setSelectedTargetClass (nextTargetClass: Ref<Class<Doc>>): void {
    if (selectedTargetClass === nextTargetClass) return

    selectedTargetClass = nextTargetClass
    fallbackSpace = undefined
    allAttrs = hierarchy.getAllAttributes(nextTargetClass, core.class.Doc)
    bindings = {}
    valueMappings = {}
    expandedMappings = {}
    refreshViewModel()
    void loadAllowedSpaceClasses(nextTargetClass)
  }

  function refreshViewModel (): void {
    allBound =
      selectedTargetClass !== undefined &&
      !allowedSpaceClassesLoading &&
      requiredSlotIds.every((id) => bindings[id] !== undefined) &&
      (allowedSpaceClasses.length === 0 || fallbackSpace !== undefined)
    selectedTargetClassLabel =
      selectedTargetClass === undefined
        ? presentation.string.NotSelected
        : getTargetClassLabel(client, selectedTargetClass)
    refreshSpaceSelector()
    requiredSlotRows = buildSlotRows(
      Object.entries(provider.requiredSlots),
      bindings,
      valueMappings,
      expandedMappings,
      allAttrs,
      fallbackSpace
    )
    optionalSlotRows = buildSlotRows(
      Object.entries(provider.optionalSlots ?? {}),
      bindings,
      valueMappings,
      expandedMappings,
      allAttrs,
      fallbackSpace
    )
  }

  function refreshSpaceSelector (): void {
    const nextAllowedSpaceClassesKey = allowedSpaceClasses.join('\u0000')
    if (nextAllowedSpaceClassesKey === allowedSpaceClassesKey) return

    allowedSpaceClassesKey = nextAllowedSpaceClassesKey
    spaceSelectClass = allowedSpaceClasses.length === 1 ? allowedSpaceClasses[0] : core.class.Space
    spaceQuery =
      allowedSpaceClasses.length > 1 ? { archived: false, _class: { $in: allowedSpaceClasses } } : { archived: false }
  }

  function setBindingValue (slotId: string, value: string): void {
    bindings = { ...bindings, [slotId]: value }
    const { [slotId]: _removedMapping, ...rest } = valueMappings
    valueMappings = rest
    refreshViewModel()
  }

  function setValueMappings (nextValueMappings: Record<string, IntegrationValueMapping>): void {
    valueMappings = nextValueMappings
    refreshViewModel()
  }

  function setExpandedMappings (nextExpandedMappings: Record<string, boolean>): void {
    expandedMappings = nextExpandedMappings
    refreshViewModel()
  }

  function onFallbackSpaceSelected (): void {
    refreshViewModel()
  }

  function setBinding (slotId: string, e: MouseEvent): void {
    if (selectedTargetClass === undefined) return

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
          setBindingValue(slotId, res as string)
        }
      }
    )
  }

  function buildSlotRows (
    entries: Array<[string, IntegrationSlotModel]>,
    currentBindings: Record<string, string>,
    currentValueMappings: Record<string, IntegrationValueMapping>,
    currentExpandedMappings: Record<string, boolean>,
    currentAttrs: typeof allAttrs,
    currentFallbackSpace: Ref<Space> | undefined
  ): SlotViewModel[] {
    return entries.map(([id, slot]) => {
      const targetOptions = getTargetValueOptions(id, currentBindings, currentAttrs, currentFallbackSpace)
      const mapping = currentValueMappings[id]
      const mappingMode = mapping?.mode ?? 'copy'
      const canMapValues = (slot.values?.length ?? 0) > 0 && targetOptions.length > 0

      return {
        id,
        label: slot.label ?? getEmbeddedLabel(slot.name ?? id),
        bindingLabel: getBindingLabel(client, currentAttrs, currentBindings, id),
        canMapValues,
        mappingExpanded: currentExpandedMappings[id],
        mappingMode,
        valueRows: (slot.values ?? []).map((option) => ({
          value: option.value,
          label: option.label ?? getEmbeddedLabel(option.value),
          mappedLabel: getMappedValueLabel(
            id,
            option.value,
            currentBindings,
            currentValueMappings,
            currentAttrs,
            currentFallbackSpace
          )
        }))
      }
    })
  }

  function getTargetValueOptions (
    slotId: string,
    currentBindings: Record<string, string> = bindings,
    currentAttrs: typeof allAttrs = allAttrs,
    currentFallbackSpace: Ref<Space> | undefined = fallbackSpace
  ): IntegrationValueOption[] {
    return getTargetAttributeValueOptions(client, currentAttrs, currentBindings[slotId], currentFallbackSpace)
  }

  function selectMappingMode (slotId: string, e: MouseEvent): void {
    showPopup(
      SelectPopup,
      {
        value: [
          { id: 'copy', label: getEmbeddedLabel('Copy') },
          { id: 'map', label: getEmbeddedLabel('Map values') },
          { id: 'ignore', label: getEmbeddedLabel('Do not sync') }
        ],
        searchable: false
      },
      eventToHTMLElement(e),
      (res) => {
        if (res == null) return
        const mode = res as IntegrationValueMappingMode
        setValueMappings({
          ...valueMappings,
          [slotId]: {
            mode,
            values: mode === 'map' ? valueMappings[slotId]?.values : undefined
          }
        })
      }
    )
  }

  function selectMappedValue (slotId: string, externalValue: string, e: MouseEvent): void {
    const targetOptions = getTargetValueOptions(slotId)
    showPopup(
      SelectPopup,
      {
        value: [
          { id: '', label: getEmbeddedLabel('Skip') },
          ...targetOptions.map((p) => ({ id: p.value, label: p.label, text: p.label ? undefined : p.value }))
        ],
        searchable: true
      },
      eventToHTMLElement(e),
      (res) => {
        if (res == null) return
        const current = valueMappings[slotId] ?? { mode: 'map' as IntegrationValueMappingMode, values: {} }
        const values = { ...(current.values ?? {}) }
        if (res === '') {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete values[externalValue]
        } else {
          values[externalValue] = res as string
        }
        setValueMappings({
          ...valueMappings,
          [slotId]: {
            mode: 'map',
            values
          }
        })
      }
    )
  }

  function getMappedValueLabel (
    slotId: string,
    externalValue: string,
    currentBindings: Record<string, string> = bindings,
    currentValueMappings: Record<string, IntegrationValueMapping> = valueMappings,
    currentAttrs: typeof allAttrs = allAttrs,
    currentFallbackSpace: Ref<Space> | undefined = fallbackSpace
  ): ReturnType<typeof getEmbeddedLabel> {
    const mappedValue = currentValueMappings[slotId]?.values?.[externalValue]
    if (mappedValue === undefined) return getEmbeddedLabel('Skip')

    return (
      getTargetValueOptions(slotId, currentBindings, currentAttrs, currentFallbackSpace).find(
        (option) => option.value === mappedValue
      )?.label ?? getEmbeddedLabel(`Missing: ${mappedValue}`)
    )
  }

  function toggleValueMapping (slotId: string): void {
    setExpandedMappings({
      ...expandedMappings,
      [slotId]: !(expandedMappings[slotId] ?? false)
    })
  }

  function onSave (): void {
    if (selectedTargetClass === undefined) return

    const fallback: IntegrationRoutingTarget = {
      targetClass: selectedTargetClass
    }
    if (fallbackSpace !== undefined) {
      fallback.space = fallbackSpace
    }

    const result = {
      provider: provider._id,
      targetClass: selectedTargetClass,
      bindings,
      valueMappings,
      fallback
    }

    dispatch('close', result)
  }

  refreshViewModel()
  void loadAllowedSpaceClasses(selectedTargetClass)
</script>

<Card
  label={provider.label}
  canSave={allBound}
  width="small"
  okLabel={presentation.string.Save}
  okAction={onSave}
  on:close
>
  <div class="flex-column flex-gap-4">
    <div class="flex-column flex-gap-1">
      <Label label={integration.string.TargetClass} />
      <Button label={selectedTargetClassLabel} kind="secondary" width="100%" on:click={selectTargetClass} />
    </div>

    <div class="flex-column flex-gap-1">
      <Label label={core.string.Space} />
      <SpaceSelect
        _class={spaceSelectClass}
        {spaceQuery}
        label={core.string.Space}
        bind:value={fallbackSpace}
        width="100%"
        kind="secondary"
        allowDeselect
        autoSelect={false}
        clearInvalidValue
        on:object={onFallbackSpaceSelected}
      />
    </div>

    <div class="ap-space x1" />

    {#each requiredSlotRows as row (row.id)}
      <div class="flex-column flex-gap-1">
        <Label label={row.label} />
        <Button
          label={row.bindingLabel}
          disabled={selectedTargetClass === undefined}
          kind="secondary"
          width="100%"
          on:click={(e) => {
            setBinding(row.id, e)
          }}
        />
        {#if row.canMapValues}
          <Button
            label={getEmbeddedLabel('Value mapping')}
            kind="secondary"
            width="100%"
            on:click={() => {
              toggleValueMapping(row.id)
            }}
          />
          {#if row.mappingExpanded}
            <div class="flex-column flex-gap-1">
              <Button
                label={getEmbeddedLabel(`Mode: ${row.mappingMode}`)}
                kind="secondary"
                width="100%"
                on:click={(e) => {
                  selectMappingMode(row.id, e)
                }}
              />
              {#if row.mappingMode === 'map'}
                {#each row.valueRows as option (option.value)}
                  <div class="flex-row-center flex-gap-2">
                    <div class="flex-grow overflow-label">
                      <Label label={option.label} />
                    </div>
                    <Button
                      label={option.mappedLabel}
                      kind="secondary"
                      on:click={(e) => {
                        selectMappedValue(row.id, option.value, e)
                      }}
                    />
                  </div>
                {/each}
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    {/each}

    {#if optionalSlotIds.length > 0}
      <div class="ap-space x1" />
      {#each optionalSlotRows as row (row.id)}
        <div class="flex-column flex-gap-1">
          <Label label={row.label} />
          <Button
            label={row.bindingLabel}
            disabled={selectedTargetClass === undefined}
            kind="secondary"
            width="100%"
            on:click={(e) => {
              setBinding(row.id, e)
            }}
          />
          {#if row.canMapValues}
            <Button
              label={getEmbeddedLabel('Value mapping')}
              kind="secondary"
              width="100%"
              on:click={() => {
                toggleValueMapping(row.id)
              }}
            />
            {#if row.mappingExpanded}
              <div class="flex-column flex-gap-1">
                <Button
                  label={getEmbeddedLabel(`Mode: ${row.mappingMode}`)}
                  kind="secondary"
                  width="100%"
                  on:click={(e) => {
                    selectMappingMode(row.id, e)
                  }}
                />
                {#if row.mappingMode === 'map'}
                  {#each row.valueRows as option (option.value)}
                    <div class="flex-row-center flex-gap-2">
                      <div class="flex-grow overflow-label">
                        <Label label={option.label} />
                      </div>
                      <Button
                        label={option.mappedLabel}
                        kind="secondary"
                        on:click={(e) => {
                          selectMappedValue(row.id, option.value, e)
                        }}
                      />
                    </div>
                  {/each}
                {/if}
              </div>
            {/if}
          {/if}
        </div>
      {/each}
    {/if}

    {#if requiredSlotIds.length === 0 && optionalSlotIds.length === 0}
      <div class="opacity-40 text-center py-4">No slots defined for this provider</div>
    {/if}
  </div>
</Card>
