<!--
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
  import type { AnyAttribute, Doc, DocumentQuery } from '@hcengineering/core'
  import { type Process, type ProcessFunction, type SelectedContext } from '@hcengineering/process'
  import { createEventDispatcher } from 'svelte'
  import { getContextFunctionReduce } from '../../utils'
  import FilterEditor from '../transformEditors/FilterEditor.svelte'

  export let context: ProcessFunction
  export let process: Process
  export let target: AnyAttribute
  export let props: Record<string, unknown> = {}
  export let onSelect: (value: SelectedContext) => void

  const dispatch = createEventDispatcher()
  const filterProps = { ...((props.query ?? {}) as DocumentQuery<Doc>), $sort: props.$sort }

  function close (event: CustomEvent<Record<string, unknown> | undefined>): void {
    if (event.detail != null) {
      const { _class, $sort, ...query } = event.detail
      onSelect({
        type: 'function',
        func: context._id,
        key: target.name,
        props: { _class, query, ...($sort == null ? {} : { $sort }) },
        sourceFunction: getContextFunctionReduce(context, target)
      })
    }
    dispatch('close')
  }
</script>

<FilterEditor
  func={context}
  {process}
  attribute={target}
  props={filterProps}
  allowSorting
  excludedKeys={['space']}
  on:close={close}
/>
