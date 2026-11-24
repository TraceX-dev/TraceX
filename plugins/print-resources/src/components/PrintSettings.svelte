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
  import core, { type Class, type Data, type Doc, type DocumentQuery, type Ref } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import presentation, { getClient } from '@hcengineering/presentation'
  import print, { defaultPrintConfiguration, type PrintConfiguration } from '@hcengineering/print'
  import { Button, Label, Loading, showPopup, type DropdownIntlItem } from '@hcengineering/ui'
  import type { BuildModelKey, Viewlet, ViewOptions, ViewletPreference } from '@hcengineering/view'
  import { TableBrowser, ViewletPanelHeader } from '@hcengineering/view-resources'
  import resources from '../plugin'
  import { validatePrintText } from '../decorations'
  import type { ComponentProps } from 'svelte'
  import EditPrintSettings from './EditPrintSettings.svelte'

  const client = getClient()
  let configurations: PrintConfiguration[] = []
  let classes: Array<DropdownIntlItem<Ref<Class<Doc>>>> = []
  $: available = classes.filter(
    (item) => !configurations.some((configuration) => configuration.targetClass === item.id)
  )

  async function load (): Promise<void> {
    const [records, candidates] = await Promise.all([
      client.findAll(print.class.PrintConfiguration, {}),
      client.findAll(core.class.Class, {})
    ])
    const hierarchy = client.getHierarchy()
    classes = candidates
      .filter(
        (candidate) =>
          !hierarchy.isMixin(candidate._id) &&
          hierarchy.classHierarchyMixin(candidate._id, print.mixin.PrintConfig) !== undefined
      )
      .map((candidate) => ({
        id: candidate._id as Ref<Class<Doc>>,
        label: candidate.label ?? getEmbeddedLabel(candidate._id)
      }))
    configurations = records.filter((record) => record.targetClass !== undefined)
  }
  const loading = load()

  async function save (next: Data<PrintConfiguration>, current?: PrintConfiguration): Promise<void> {
    if (!classes.some((item) => item.id === next.targetClass)) throw new Error('Unsupported print configuration class')
    if (/[\r\n]/.test(next.header + next.footer)) throw new Error('Print text must be single-line')
    await validatePrintText(client, [next.header, next.footer])
    const records = await client.findAll(print.class.PrintConfiguration, { targetClass: next.targetClass })
    if (records.some((record) => record._id !== current?._id))
      throw new Error('Print configuration already exists for this class')
    const data: Data<PrintConfiguration> = { ...next }
    if (current === undefined) {
      await client.createDoc(print.class.PrintConfiguration, core.space.Workspace, data)
    } else {
      await client.updateDoc(current._class, current.space, current._id, data)
    }
    await load()
  }

  function edit (current?: PrintConfiguration): void {
    const targetClass = current?.targetClass ?? available[0]?.id
    if (targetClass === undefined) return
    const defaults =
      client.getHierarchy().classHierarchyMixin(targetClass, print.mixin.PrintConfig)?.defaultConfiguration ??
      defaultPrintConfiguration
    const values: Data<PrintConfiguration> =
      current === undefined
        ? { ...defaults, targetClass }
        : {
            targetClass,
            enabled: current.enabled,
            header: current.header,
            footer: current.footer,
            printLogo: current.printLogo
          }
    const items = classes.map((item) => ({
      ...item,
      disabled: configurations.some((record) => record._id !== current?._id && record.targetClass === item.id)
    }))
    const props: ComponentProps<EditPrintSettings> = {
      values,
      classes: items,
      onSave: async (next): Promise<void> => {
        await save(next, current)
      }
    }
    showPopup(EditPrintSettings, props)
  }

  function create (): void {
    edit()
  }

  let viewlet: Viewlet | undefined
  let viewOptions: ViewOptions | undefined
  let preference: ViewletPreference | undefined
  let viewletLoading = true
  const query: DocumentQuery<PrintConfiguration> = { targetClass: { $exists: true } }
  let resultQuery = query

  function withEditor (column: BuildModelKey | string): BuildModelKey | string {
    if (typeof column === 'string' && column !== '') return column
    if (typeof column !== 'string' && column.key !== '') return column
    const key: BuildModelKey = {
      ...(typeof column === 'string' ? { key: column, label: core.string.Class } : column),
      props: { ...(typeof column === 'string' ? {} : column.props), onOpen: edit }
    }
    return key
  }
  $: tableConfig = (preference?.config ?? viewlet?.config ?? []).map(withEditor)
</script>

<div class="hulyComponent">
  <ViewletPanelHeader
    _class={print.class.PrintConfiguration}
    viewletQuery={{ _id: resources.viewlet.PrintConfigurations }}
    bind:viewlet
    bind:viewOptions
    bind:preference
    bind:loading={viewletLoading}
    title={print.string.Printing}
    icon={print.icon.Print}
    {query}
    bind:resultQuery
    adaptive="disabled"
  >
    <svelte:fragment slot="actions">
      <Button label={presentation.string.Create} on:click={create} disabled={available.length === 0} />
    </svelte:fragment>
  </ViewletPanelHeader>
  <div class="hulyComponent-content__column content">
    {#await loading}
      <div class="w-full h-full flex-col-center justify-center"><Loading /></div>
    {:then}
      {#if viewletLoading}
        <Loading />
      {:else if viewlet !== undefined}
        <TableBrowser
          _class={print.class.PrintConfiguration}
          config={tableConfig}
          options={viewlet.options}
          query={resultQuery}
          {viewlet}
          {viewOptions}
          prefferedSorting="targetClass"
          enableChecking={false}
          readonly
        />
      {/if}
    {:catch}
      <Label label={print.string.InvalidPrintSettings} />
    {/await}
  </div>
</div>
