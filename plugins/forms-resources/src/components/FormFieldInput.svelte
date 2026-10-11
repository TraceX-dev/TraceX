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
-->
<script lang="ts">
  import type { FormField } from '@hcengineering/forms'
  import { DateRangeMode } from '@hcengineering/core'
  import ui, {
    DatePresenter,
    Dropdown,
    DropdownLabels,
    EditBox,
    Label,
    NumberInput,
    TextArea,
    Toggle,
    type ListItem
  } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import forms from '../plugin'

  export let field: FormField
  export let value: unknown = undefined
  export let disabled = false

  const dispatch = createEventDispatcher<{ change: { value: unknown, valid: boolean } }>()
  const initial = value ?? field.defaultValue
  let text: string =
    field.kind === 'json' || field.kind === 'array'
      ? initial === undefined
        ? ''
        : JSON.stringify(initial)
      : typeof initial === 'string' || typeof initial === 'number'
        ? String(initial)
        : ''
  let checked = initial === true
  let selectedValues: string[] = Array.isArray(initial)
    ? initial.filter((item): item is string => typeof item === 'string')
    : []
  let numeric: number | undefined = typeof initial === 'number' ? initial : undefined
  let date: number | null | undefined = typeof initial === 'number' ? initial : undefined
  let invalid = false
  $: items = (field.values ?? []).map((item) => ({ _id: item, label: item }))
  $: selected = items.find((item) => item._id === text)
  $: enumItems = (field.item?.values ?? []).map((item) => ({ id: item, label: item }))

  function update (
    text: string | number | undefined,
    checked: boolean,
    date: number | null | undefined,
    numeric: number | undefined,
    selectedValues: string[]
  ): void {
    let result: unknown = text
    invalid = false
    if (field.kind === 'boolean') result = checked
    else if (field.kind === 'date') result = date ?? undefined
    else if (field.kind === 'number') result = numeric
    else if (field.kind === 'array' && field.item?.kind === 'enum') result = selectedValues
    else if (text === '' || text === undefined) result = undefined
    else if (field.kind === 'json' || field.kind === 'array') {
      try {
        result = JSON.parse(String(text))
      } catch {
        invalid = true
      }
      if (field.kind === 'array' && !Array.isArray(result)) invalid = true
    }
    if (typeof result === 'number' && !Number.isFinite(result)) invalid = true
    dispatch('change', { value: result, valid: !invalid })
  }

  function edit (event: CustomEvent<string | number | undefined>): void {
    text = String(event.detail ?? '')
  }

  function select (event: CustomEvent<ListItem>): void {
    text = event.detail._id
  }
  function selectMultiple (event: CustomEvent<string[]>): void {
    selectedValues = event.detail
  }
  $: update(text, checked, date, numeric, selectedValues)
</script>

<fieldset class="field" aria-labelledby={`label-${field.name}`} {disabled}>
  {#if field.kind !== 'boolean'}
    <div id={`label-${field.name}`} class="field-label">
      <Label label={field.label} />{#if field.required}<span aria-hidden="true"> *</span>{/if}
    </div>
  {/if}
  {#if field.kind === 'boolean'}
    <div class="boolean-field">
      <Toggle inputId={`input-${field.name}`} ariaLabelledBy={`label-${field.name}`} bind:on={checked} {disabled} />
      <label id={`label-${field.name}`} for={`input-${field.name}`} class="field-label">
        <Label label={field.label} />{#if field.required}<span aria-hidden="true"> *</span>{/if}
      </label>
    </div>
  {:else if field.kind === 'number'}
    <NumberInput bind:value={numeric} maxWidth="12rem" {disabled} />
  {:else if field.kind === 'enum'}
    <Dropdown
      {items}
      {selected}
      placeholder={ui.string.NotSelected}
      {disabled}
      kind="regular"
      size="large"
      justify="left"
      width="100%"
      on:selected={select}
    />
  {:else if field.kind === 'array' && field.item?.kind === 'enum'}
    <DropdownLabels
      items={enumItems}
      selected={selectedValues}
      multiselect
      autoSelect={false}
      showDropdownIcon
      {disabled}
      kind="regular"
      size="large"
      justify="left"
      width="100%"
      on:selected={selectMultiple}
    />
  {:else if field.kind === 'date'}
    <DatePresenter
      bind:value={date}
      mode={DateRangeMode.DATE}
      editable={!disabled}
      kind="regular"
      size="large"
      width="100%"
      label={field.label}
      detail={undefined}
      labelNull={ui.string.SelectDate}
    />
  {:else if field.kind === 'markup' || field.kind === 'array' || field.kind === 'json'}
    <TextArea bind:value={text} width="100%" {disabled} />
    {#if field.kind !== 'markup'}<small><Label label={forms.string.JsonHint} /></small>{/if}
  {:else}
    <EditBox id={`input-${field.name}`} value={text} on:value={edit} {disabled} required={field.required} fullSize />
  {/if}
  {#if invalid}<small role="alert"><Label label={forms.string.InvalidField} /></small>{/if}
</fieldset>

<style lang="scss">
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-1);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .field-label {
    font-weight: 500;
  }
  .boolean-field {
    display: flex;
    align-items: center;
    gap: var(--spacing-2);
  }
  small {
    color: var(--theme-caption-color);
  }
</style>
