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
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import plugin from '../../plugin'

  export let params: Record<string, any>

  const client = getClient()
  $: association =
    params.association !== undefined ? client.getModel().findObject(params.association as Ref<Association>) : undefined
  $: modeLabel =
    params.mode === 'added'
      ? plugin.string.RelationAdded
      : params.mode === 'removed'
        ? plugin.string.RelationRemoved
        : params.mode === 'changed'
          ? plugin.string.RelationChanged
          : undefined
</script>

{#if association}
  : {params.direction === 'A' ? association.nameA : association.nameB}
{/if}
{#if modeLabel}
  · <Label label={modeLabel} />
{/if}
