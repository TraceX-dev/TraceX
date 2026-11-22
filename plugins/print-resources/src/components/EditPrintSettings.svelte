<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import card from '@hcengineering/card'
  import setting from '@hcengineering/setting'
  import { Analytics } from '@hcengineering/analytics'
  import core, { type Class, type Data, type Doc, type Ref } from '@hcengineering/core'
  import type { ComponentProps } from 'svelte'
  import { Card, getClient } from '@hcengineering/presentation'
  import print, { type PrintConfiguration } from '@hcengineering/print'
  import templates, { type TemplateField } from '@hcengineering/templates'
  import ui, {
    Button,
    IconDropdown,
    SelectPopup,
    type SelectPopupValueType,
    EditBox,
    Label,
    Toggle,
    type DropdownIntlItem,
    eventToHTMLElement,
    showPopup
  } from '@hcengineering/ui'

  export let values: Data<PrintConfiguration>
  export let classes: Array<DropdownIntlItem<Ref<Class<Doc>>>>
  export let onSave: (next: Data<PrintConfiguration>) => Promise<void>

  const hierarchy = getClient().getHierarchy()

  let targetClass = values.targetClass
  $: selectedClass = classes.find((item) => item.id === targetClass)
  let enabled = values.enabled
  let header = values.header
  let footer = values.footer
  let printLogo = values.printLogo
  let saving = false
  let failed = false

  function classOptions (): SelectPopupValueType[] {
    const baseClasses: SelectPopupValueType[] = []
    const cardTypes: SelectPopupValueType[] = []
    for (const item of classes) {
      if (item.disabled === true) continue
      const isClass = hierarchy.getClass(item.id)._class === core.class.Class
      const option: SelectPopupValueType = {
        id: item.id,
        label: item.label,
        isSelected: item.id === targetClass,
        category: { label: isClass ? setting.string.Classes : card.string.MasterTags }
      }
      if (isClass) baseClasses.push(option)
      else cardTypes.push(option)
    }
    return [...baseClasses, ...cardTypes]
  }

  function selectClass (event: MouseEvent): void {
    const props: ComponentProps<SelectPopup> = {
      value: classOptions(),
      searchable: true,
      placeholder: ui.string.Search
    }
    showPopup(SelectPopup, props, eventToHTMLElement(event), (id: SelectPopupValueType['id'] | undefined): void => {
      const selected = classes.find((item) => item.id === id && item.disabled !== true)
      if (selected !== undefined) targetClass = selected.id
    })
  }

  function insertField (event: MouseEvent, target: 'header' | 'footer'): void {
    showPopup(templates.component.FieldPopup, {}, eventToHTMLElement(event), (field: TemplateField | undefined) => {
      if (field === undefined) return
      const token = '${' + field._id + '}'
      if (target === 'header') header += token
      else footer += token
    })
  }

  function insertHeaderField (event: MouseEvent): void {
    insertField(event, 'header')
  }

  function insertFooterField (event: MouseEvent): void {
    insertField(event, 'footer')
  }

  function changeEnabled (event: CustomEvent<boolean>): void {
    enabled = event.detail
  }

  function changeLogo (event: CustomEvent<boolean>): void {
    printLogo = event.detail
  }

  async function save (): Promise<boolean> {
    if (saving) return false
    saving = true
    failed = false
    try {
      const next: Data<PrintConfiguration> = { targetClass, enabled, header, footer, printLogo }
      await onSave(next)
      return true
    } catch (error) {
      failed = true
      Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
      return false
    } finally {
      saving = false
    }
  }
</script>

<Card
  label={print.string.PrintSettings}
  okLabel={ui.string.Save}
  okAction={save}
  canSave={!saving}
  width="medium"
  on:close
>
  <div class="settings-grid">
    <div class="field-label"><Label label={core.string.Class} /></div>
    <Button
      label={selectedClass?.label ?? core.string.Class}
      iconRight={IconDropdown}
      on:click={selectClass}
      disabled={saving}
      justify="left"
      width="100%"
    />
    <label class="field-label" for="print-enabled"><Label label={print.string.Enabled} /></label>
    <div><Toggle inputId="print-enabled" on={enabled} on:change={changeEnabled} disabled={saving} /></div>
    <label class="field-label" for="print-header"><Label label={print.string.Header} /></label>
    <div class="flex-row-center flex-gap-2 min-w-0">
      <EditBox id="print-header" bind:value={header} disabled={saving} fullSize autoFocus />
      <Button label={print.string.InsertField} on:click={insertHeaderField} disabled={saving} />
    </div>
    <label class="field-label" for="print-footer"><Label label={print.string.Footer} /></label>
    <div class="flex-row-center flex-gap-2 min-w-0">
      <EditBox id="print-footer" bind:value={footer} disabled={saving} fullSize />
      <Button label={print.string.InsertField} on:click={insertFooterField} disabled={saving} />
    </div>
    <label class="field-label" for="print-logo"><Label label={print.string.PrintLogo} /></label>
    <div>
      <Toggle inputId="print-logo" on={printLogo} on:change={changeLogo} disabled={saving} />
    </div>
  </div>
  {#if failed}<div class="mt-4"><Label label={print.string.InvalidPrintSettings} /></div>{/if}
</Card>

<style lang="scss">
  .settings-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 3fr);
    align-items: center;
    gap: var(--spacing-4);
  }
</style>
