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
  import core, { type AnyAttribute, type Doc, type SortingQuery } from '@hcengineering/core'
  import presentation, { Card, getAttributePresenterClass, getClient } from '@hcengineering/presentation'
  import { Process, ProcessFunction } from '@hcengineering/process'
  import { Button, SelectPopup, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import processPlugin from '../../plugin'
  import { getCriteriaEditor } from '../../utils'
  import CriteriasEditor from '../criterias/CriteriasEditor.svelte'
  import FunctionSortEditor from './FunctionSortEditor.svelte'

  export let func: ProcessFunction
  export let process: Process
  export let attribute: AnyAttribute
  export let props: Record<string, any> = {}

  const dispatch = createEventDispatcher()
  const client = getClient()
  const hierarchy = client.getHierarchy()
  const presenterClass = getAttributePresenterClass(hierarchy, attribute.type)
  const allowSorting = func._id === processPlugin.function.FirstMatchValue

  function getCriteriaProps (value: Record<string, any>): Record<string, any> {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '_class' && key !== '$sort'))
  }

  let criteria = getCriteriaProps(props)
  let sort = props.$sort as SortingQuery<Doc> | undefined

  function save (): void {
    dispatch('close', {
      ...criteria,
      _class: presenterClass.attrClass,
      ...(!allowSorting || sort == null ? {} : { $sort: sort })
    })
  }

  function getKeys (): AnyAttribute[] {
    const attributes = hierarchy.getAllAttributes(presenterClass.attrClass, core.class.Doc)
    const res: AnyAttribute[] = []
    for (const [key, attr] of attributes) {
      if (key === '_id' || key === '_class') continue
      if (attr.hidden === true) continue
      const presenterClass = getAttributePresenterClass(hierarchy, attr.type)
      const updateCriteria = getCriteriaEditor(presenterClass.attrClass, presenterClass.category)
      const editor = updateCriteria?.editor
      if (editor == null) continue
      res.push(attr)
    }
    return res
  }

  let keys = Object.keys(criteria)

  const allAttrs = getKeys()
  $: possibleAttrs = allAttrs.filter((attr) => !keys.includes(attr.name))

  function onAdd (e: MouseEvent): void {
    showPopup(
      SelectPopup,
      {
        value: possibleAttrs.map((p) => {
          return { id: p.name, label: p.label }
        })
      },
      eventToHTMLElement(e),
      (res) => {
        if (res != null) {
          addKey(res)
        }
      }
    )
  }

  function addKey (key: string): void {
    keys = [...keys, key]
  }

  function remove (e: CustomEvent<any>): void {
    if (e.detail !== undefined) {
      const key = e.detail.key
      keys = keys.filter((k) => k !== key)
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (criteria as any)[key]
    }
  }

  function change (e: CustomEvent<any>): void {
    if (e.detail == null) return
    criteria = e.detail
  }
</script>

<Card
  on:close
  width={allowSorting ? 'small' : 'x-small'}
  label={func.label}
  canSave
  okAction={save}
  okLabel={presentation.string.Save}
>
  <CriteriasEditor
    _class={presenterClass.attrClass}
    readonly={false}
    {keys}
    {process}
    params={criteria}
    on:remove={remove}
    on:change={change}
  />
  {#if possibleAttrs.length > 0}
    <div class="flex-center mt-4">
      <Button label={presentation.string.Add} width={'100%'} kind={'link-bordered'} size={'large'} on:click={onAdd} />
    </div>
  {/if}
  {#if allowSorting}
    <div class="mt-4">
      <FunctionSortEditor _class={presenterClass.attrClass} bind:sort />
    </div>
  {/if}
</Card>
