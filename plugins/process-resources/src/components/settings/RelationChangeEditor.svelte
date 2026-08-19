<!--
//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->

<script lang="ts">
  import { type Association, type Ref } from '@hcengineering/core'
  import { type Process } from '@hcengineering/process'
  import { DropdownIntlItem, DropdownLabelsIntl, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import plugin from '../../plugin'
  import AssociationSelector from './AssociationSelector.svelte'

  type RelationChangeMode = 'added' | 'removed' | 'changed'

  export let readonly: boolean
  export let process: Process
  export let params: Record<string, any>

  const dispatch = createEventDispatcher()
  const items: DropdownIntlItem[] = [
    { id: 'added', label: plugin.string.RelationAdded },
    { id: 'removed', label: plugin.string.RelationRemoved },
    { id: 'changed', label: plugin.string.RelationChanged }
  ]

  let association = params.association as Ref<Association> | undefined
  let direction = params.direction as 'A' | 'B' | undefined
  let mode = params.mode as RelationChangeMode | undefined

  function save (): void {
    if (readonly) return
    params = { ...params, association, direction, mode }
    dispatch('change', { params })
  }

  function changeAssociation (event: CustomEvent<{ association?: Ref<Association>, direction?: 'A' | 'B' }>): void {
    association = event.detail.association
    direction = event.detail.direction
    save()
  }

  function changeMode (event: CustomEvent<RelationChangeMode>): void {
    mode = event.detail
    save()
  }
</script>

<div class="editor-grid">
  <Label label={plugin.string.WhenRelationChanges} />
  <AssociationSelector {process} {association} {direction} on:change={changeAssociation} />
  <Label label={plugin.string.ActionType} />
  <DropdownLabelsIntl disabled={readonly} {items} selected={mode} on:selected={changeMode} width={'100%'} />
</div>
