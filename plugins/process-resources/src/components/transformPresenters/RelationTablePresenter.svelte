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
  import { getClient } from '@hcengineering/presentation'
  import { type SelectedContextFunc } from '@hcengineering/process'
  import { Label } from '@hcengineering/ui'

  export let contextValue: SelectedContextFunc

  const client = getClient()
  const func = client.getModel().findObject(contextValue.func)
  const name = contextValue.props?.name ?? ''
  const sort = contextValue.props?.$sort ?? contextValue.props?.sort
  const sortField = sort != null ? Object.keys(sort)[0] : undefined
  $: sortAttr =
    sortField != null && contextValue.props?.targetClass != null
      ? client.getHierarchy().findAttribute(contextValue.props.targetClass, sortField)
      : undefined
</script>

{#if func !== undefined}
  <div>
    <Label label={func.label} />: {name}{#if sortAttr !== undefined}
      {' '}(<Label label={sortAttr.label} />){:else if sortField != null}
      {' '}({sortField}){/if}
  </div>
{/if}
