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
  import { MasterTag } from '@hcengineering/card'
  import { DefinitionYamlEditor, newDefinitionYaml } from '@hcengineering/card-resources'
  import core, { Doc, generateId, Ref, SortingOrder } from '@hcengineering/core'
  import { setPlatformStatus, translate, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Process, State } from '@hcengineering/process'
  import { makeRank } from '@hcengineering/rank'
  import {
    ButtonIcon,
    getCurrentLocation,
    Icon,
    IconAdd,
    IconFile,
    IconEdit,
    Label,
    navigate,
    showPopup
  } from '@hcengineering/ui'
  import { SortableDocList } from '@hcengineering/view-resources'
  import { applyProcessDefinition } from '../authoring-ui'
  import process from '../plugin'

  export let masterTag: MasterTag

  const client = getClient()

  async function add (): Promise<void> {
    const initState = generateId<State>()
    const rank = makeRank(processes[processes.length - 1]?.rank, undefined)
    const id = await client.createDoc(process.class.Process, core.space.Model, {
      name: await translate(process.string.NewProcess, {}),
      masterTag: masterTag._id,
      rank,
      context: {},
      description: ''
    })
    await client.createDoc(
      process.class.State,
      core.space.Model,
      {
        process: id,
        rank: makeRank(undefined, undefined),
        title: await translate(process.string.NewState, {})
      },
      initState
    )
    await client.createDoc(process.class.Transition, core.space.Model, {
      process: id,
      from: null,
      to: initState,
      trigger: process.trigger.OnExecutionStart,
      rank: makeRank(undefined, undefined),
      actions: [],
      triggerParams: {}
    })
    handleSelect(id)
  }

  let processes: Process[] = []

  const query = createQuery()

  query.query(
    process.class.Process,
    {
      masterTag: masterTag._id
    },
    (res) => {
      processes = res
    },
    { sort: { rank: SortingOrder.Ascending } }
  )

  function handleSelect (id: Ref<Process>): void {
    const loc = getCurrentLocation()
    loc.path[5] = process.component.ProcessEditor
    loc.path[6] = id
    navigate(loc, true)
  }

  function toProcess (doc: Doc): Process {
    return doc as Process
  }

  function handleImport (): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.yaml,.yml'
    input.onchange = async (evt) => {
      const file = (evt.target as HTMLInputElement).files?.[0]
      if (file == null) return
      try {
        await applyProcessDefinition(masterTag._id, await file.text())
      } catch (error) {
        await setPlatformStatus(unknownError(error))
      }
    }
    input.click()
  }

  function handleYaml (): void {
    showPopup(
      DefinitionYamlEditor,
      {
        kind: 'process',
        source: newDefinitionYaml('process'),
        onApply: async (source: string) => await applyProcessDefinition(masterTag._id, source)
      },
      'centered'
    )
  }
</script>

<div class="hulyTableAttr-header font-medium-12">
  <Icon icon={process.icon.Process} size="small" />
  <span><Label label={process.string.Processes} /></span>
  <div class="flex-row-center flex-gap-1">
    <ButtonIcon
      kind="primary"
      icon={IconFile}
      size="small"
      tooltip={{ label: process.string.Import, direction: 'bottom' }}
      on:click={handleImport}
    />
    <ButtonIcon kind="primary" icon={IconAdd} size="small" dataId={'btnAdd'} on:click={add} />
    <ButtonIcon
      kind="primary"
      icon={IconEdit}
      size="small"
      tooltip={{ label: process.string.YamlEditor, direction: 'bottom' }}
      on:click={handleYaml}
    />
  </div>
</div>
{#if processes.length}
  <div class="hulyTableAttr-content task">
    <SortableDocList _class={process.class.Process} query={{ masterTag: masterTag._id }}>
      <svelte:fragment slot="object" let:value>
        {@const processValue = toProcess(value)}
        <button
          class="hulyTableAttr-content__row justify-start"
          on:click|stopPropagation={() => {
            handleSelect(processValue._id)
          }}
        >
          <div class="hulyTableAttr-content__row-label px-2 font-medium-14 cursor-pointer">
            {processValue.name}
          </div>
        </button>
      </svelte:fragment>
    </SortableDocList>
  </div>
{/if}
