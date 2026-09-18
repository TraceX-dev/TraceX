<!--
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
  import { Analytics } from '@hcengineering/analytics'
  import card from '@hcengineering/card'
  import type { CardSpace } from '@hcengineering/card'
  import core from '@hcengineering/core'
  import type { RefTo } from '@hcengineering/core'
  import { getResource } from '@hcengineering/platform'
  import { findAttributeEditorByAttribute, getClient } from '@hcengineering/presentation'
  import type { Process } from '@hcengineering/process'
  import type { AnySvelteComponent } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { getSelectionSpaceContext } from '../../selection-space'
  import { getMockAttribute } from '../../utils'
  import ProcessAttribute from '../ProcessAttribute.svelte'

  export let process: Process
  export let value: string | undefined

  const client = getClient()
  const dispatch = createEventDispatcher<{ change: string | undefined }>()
  const type: RefTo<CardSpace> = {
    _class: core.class.RefTo,
    label: core.string.Ref,
    to: card.class.CardSpace
  }
  const attribute = getMockAttribute(card.class.CardSpace, core.string.Space, type)
  let editor: AnySvelteComponent | undefined
  const resource = findAttributeEditorByAttribute(client, attribute)
  if (resource !== undefined) {
    void getResource(resource)
      .then((component) => {
        editor = component
      })
      .catch((error: unknown) => {
        Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
      })
  }

  $: context = getSelectionSpaceContext(client, process)

  function change (selected: string | undefined): void {
    value = selected
    dispatch('change', selected)
  }
</script>

<ProcessAttribute
  {process}
  masterTag={process.masterTag}
  {attribute}
  {context}
  {editor}
  {value}
  presenterClass={{ attrClass: core.class.Space, category: 'object' }}
  allowRemove
  allowUserRequest={false}
  allowConfigure={false}
  on:change={(event) => {
    change(event.detail)
  }}
  on:remove={() => {
    change(undefined)
  }}
/>
