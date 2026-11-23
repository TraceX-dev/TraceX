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
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import type { PrintConfiguration } from '@hcengineering/print'
  import { Label } from '@hcengineering/ui'
  import { DocNavLink } from '@hcengineering/view-resources'

  export let value: PrintConfiguration
  export let onOpen: ((configuration: PrintConfiguration) => void) | undefined = undefined

  const hierarchy = getClient().getHierarchy()
  $: label = hierarchy.hasClass(value.targetClass)
    ? (hierarchy.getClass(value.targetClass).label ?? getEmbeddedLabel(value.targetClass))
    : getEmbeddedLabel(value.targetClass)

  function open (): void {
    onOpen?.(value)
  }
</script>

{#if onOpen !== undefined}
  <DocNavLink object={value} onClick={open}><Label {label} /></DocNavLink>
{:else}
  <Label {label} />
{/if}
