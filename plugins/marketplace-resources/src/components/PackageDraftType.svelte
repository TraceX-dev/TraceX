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
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import core, { type Doc, type Ref } from '@hcengineering/core'
  import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import type { AuthoringNativeDocument } from '@hcengineering/process'
  import { Label } from '@hcengineering/ui'

  export let value: unknown
  export let documents: readonly AuthoringNativeDocument[] = []
  export let depth = 0

  $: type = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined

  function label (id: unknown): IntlString {
    if (typeof id !== 'string') return getEmbeddedLabel('—')
    const definition = documents.find((doc) => doc._id === id)
    const installed = getClient()
      .getModel()
      .findObject<Doc & { label?: IntlString, name?: string }>(id as Ref<Doc>)
    const name = definition?.label ?? installed?.label
    return typeof name === 'string'
      ? (name as IntlString)
      : getEmbeddedLabel(String(definition?.name ?? installed?.name ?? id))
  }
</script>

{#if type?._class === core.class.ArrOf && depth < 8}
  <svelte:self value={type.of} {documents} depth={depth + 1} />[]
{:else if type?._class === core.class.RefTo}
  <Label label={label(core.class.RefTo)} /> · <Label label={label(type.to)} />
{:else if type?._class === core.class.EnumOf}
  <Label label={label(type.of)} />
{:else}
  <Label label={label(type?._class)} />
{/if}
