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
  import { Ref, SortingOrder } from '@hcengineering/core'
  import { DefinitionYamlEditor, downloadDefinition } from '@hcengineering/card-resources'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient, MessageBox, IconDownload } from '@hcengineering/presentation'
  import { Process, State, Transition } from '@hcengineering/process'
  import { clearSettingsStore, settingsStore } from '@hcengineering/setting-resources'
  import {
    ButtonIcon,
    ButtonMenu,
    defineSeparators,
    DropdownIntlItem,
    EditBox,
    getCurrentLocation,
    IconDelete,
    IconDetails,
    IconEdit,
    IconSettings,
    navigate,
    Scroller,
    secondNavSeparators,
    showPopup,
    IconLink
  } from '@hcengineering/ui'
  import { exportProcessDraft, exportProcessSource } from '../../exporter'
  import { applyProcessDefinition } from '../../authoring-ui'
  import view from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'
  import process from '../../plugin'
  import ContextEditor from './ContextEditor.svelte'
  import BindingsEditor from './BindingsEditor.svelte'
  import Navigator from './Navigator.svelte'
  import ProcesssSetting from './ProcesssSetting.svelte'
  import StatesInlineEditor from './StatesInlineEditor.svelte'
  import TransitionsInlineEditor from './TransitionsInlineEditor.svelte'
  import ProcessDiagram from './ProcessDiagram.svelte'

  export let _id: Ref<Process>
  export let visibleSecondNav: boolean = true

  const readonly: boolean = false

  const client = getClient()
  const query = createQuery()
  const statesQuery = createQuery()
  const transitionsQ = createQuery()

  const dispatch = createEventDispatcher()

  let value: Process | undefined
  let states: State[] = []
  let transitions: Transition[] = []

  $: query.query(process.class.Process, { _id }, (res) => {
    value = res[0]
    if (value !== undefined) {
      dispatch('change', [
        {
          title: value.name,
          id: value._id,
          editor: process.component.ProcessEditor
        }
      ])
    }
  })

  $: statesQuery.query(
    process.class.State,
    { process: _id },
    (res) => {
      states = res
    },
    {
      sort: { rank: SortingOrder.Ascending }
    }
  )

  $: transitionsQ.query(
    process.class.Transition,
    { process: _id },
    (res) => {
      transitions = res
    },
    {
      sort: { rank: SortingOrder.Ascending }
    }
  )

  async function saveName (): Promise<void> {
    if (value !== undefined) {
      await client.update(value, { name: value.name })
    }
  }

  async function deleteProcess (): Promise<void> {
    if (value === undefined) return
    // to do handle on server trigger
    await client.remove(value)
    const loc = getCurrentLocation()
    loc.path.length = 5
    clearSettingsStore()
    navigate(loc)
  }

  async function handleDelete (): Promise<void> {
    if (value === undefined) return
    const execution = await client.findOne(process.class.Execution, { process: value?._id })
    if (execution !== undefined) {
      showPopup(MessageBox, {
        label: process.string.DeleteProcess,
        message: process.string.DeleteProcessConfirm,
        action: async () => {
          await deleteProcess()
        }
      })
    } else {
      await deleteProcess()
    }
  }

  defineSeparators('spaceTypeEditor', secondNavSeparators)

  function handleContext (): void {
    $settingsStore = {
      id: value?._id,
      component: ContextEditor,
      props: { readonly, process: value }
    }
  }

  function handleSettings (): void {
    showPopup(ProcesssSetting, { value })
  }

  function handleBindings (): void {
    showPopup(BindingsEditor, { process: value })
  }

  function handleDiagram (): void {
    if (value !== undefined) {
      showPopup(ProcessDiagram, { process: value, fullSize: true }, 'centered')
    }
  }

  const EXPORT_WITH_SLOTS = 'with-slots'
  const EXPORT_WITHOUT_SLOTS = 'without-slots'
  const EXPORT_YAML = 'yaml'

  let exportItems: DropdownIntlItem[]
  $: exportItems = [
    {
      id: EXPORT_WITH_SLOTS,
      label: process.string.ExportJsonWithSlots
    },
    {
      id: EXPORT_WITHOUT_SLOTS,
      label: process.string.ExportJsonWithoutSlots
    },
    {
      id: EXPORT_YAML,
      label: process.string.ExportYaml
    }
  ]

  function onExportSelected (event: CustomEvent<string | number>): void {
    if (event.detail === EXPORT_WITH_SLOTS) {
      void handleExport('json', true)
    } else if (event.detail === EXPORT_WITHOUT_SLOTS) {
      void handleExport('json', false)
    } else if (event.detail === EXPORT_YAML) {
      void handleExport('yaml')
    }
  }

  async function handleExport (format: 'json' | 'yaml', withSlots = true): Promise<void> {
    if (value === undefined) return
    try {
      downloadDefinition(exportProcessSource(value, format, withSlots), value.name, format)
    } catch (error) {
      await setPlatformStatus(unknownError(error))
    }
  }

  async function handleYaml (): Promise<void> {
    if (value === undefined) return
    const current = value
    try {
      const draft = exportProcessDraft(current)
      showPopup(
        DefinitionYamlEditor,
        {
          kind: 'process',
          name: current.name,
          source: draft.source,
          onApply: async (source: string) => await applyProcessDefinition(current.masterTag, source, draft.bindings),
          onSave: async (source: string) =>
            await applyProcessDefinition(current.masterTag, source, draft.bindings, current)
        },
        'centered'
      )
    } catch (error) {
      await setPlatformStatus(unknownError(error))
    }
  }
</script>

<div class="hulyComponent-content__container columns">
  <Navigator {visibleSecondNav} {states} {transitions} />
  <div class="hulyComponent-content__column content">
    {#if value}
      <Scroller align="center" padding="var(--spacing-3)" bottomPadding="var(--spacing-3)">
        <div class="hulyComponent-content gap">
          <div class="header flex-between">
            <EditBox
              bind:value={value.name}
              kind="modern-ghost-large"
              on:change={saveName}
              required
              placeholder={process.string.Untitled}
            />
            <div class="flex-row-center flex-gap-2">
              {#if value.requiredSlots && Object.keys(value.requiredSlots).length > 0}
                <ButtonIcon
                  icon={IconLink}
                  tooltip={{ label: process.string.Bindings, direction: 'bottom' }}
                  size="small"
                  kind="secondary"
                  on:click={handleBindings}
                />
              {/if}
              <ButtonIcon icon={IconSettings} size="small" kind="secondary" on:click={handleSettings} />
              <ButtonMenu
                icon={IconDownload}
                tooltip={{ label: process.string.Export, direction: 'bottom' }}
                size="small"
                kind="secondary"
                items={exportItems}
                noSelection
                on:selected={onExportSelected}
              />
              <ButtonIcon
                icon={IconEdit}
                tooltip={{ label: process.string.YamlEditor, direction: 'bottom' }}
                size="small"
                kind="secondary"
                on:click={handleYaml}
              />
              <ButtonIcon
                icon={IconDetails}
                tooltip={{ label: process.string.Data, direction: 'bottom' }}
                size="small"
                kind="secondary"
                on:click={handleContext}
              />
              <ButtonIcon
                icon={process.icon.States}
                tooltip={{ label: process.string.ProcessDiagram, direction: 'bottom' }}
                size="small"
                kind="secondary"
                on:click={handleDiagram}
              />
              <ButtonIcon
                icon={IconDelete}
                tooltip={{ label: view.string.Delete, direction: 'bottom' }}
                size="small"
                kind="secondary"
                on:click={handleDelete}
              />
            </div>
          </div>
          <div class="hulyComponent-content flex-col-center flex-gap-4">
            <StatesInlineEditor {states} {readonly} process={value} />
            <TransitionsInlineEditor {readonly} process={value} />
          </div>
        </div>
      </Scroller>
    {/if}
  </div>
</div>

<style lang="scss">
  .state {
    font-weight: 500;
    color: var(--global-tertiary-TextColor);
    padding: 0 var(--spacing-1_5) 0 var(--spacing-1_25);
    min-height: 1.75rem;
    margin: 0 0.75rem;
  }
</style>
