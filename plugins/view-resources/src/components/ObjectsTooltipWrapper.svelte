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
  import type { Class, Doc, Ref } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import { tooltip, type LabelAndProps, type TooltipAlignment } from '@hcengineering/ui'

  import ObjectsTooltip from './ObjectsTooltip.svelte'

  export let selectedCount: number
  export let objects: Doc[] = []
  export let objectIds: Ref<Doc>[] = []
  export let _class: Ref<Class<Doc>> | undefined = undefined
  export let label: IntlString | undefined = undefined
  export let direction: TooltipAlignment | undefined = undefined
  export let readonly: boolean = false
  export let width: string | undefined = undefined

  $: tooltipOptions = (selectedCount > 0
    ? { component: ObjectsTooltip, props: { objects, objectIds, _class }, direction }
    : { label, direction }) satisfies LabelAndProps
</script>

<style lang="scss">
  .objects-tooltip-wrapper {
    display: inline-flex;
    min-width: 0;
    max-width: 100%;

    &.readonly :global(button:disabled) {
      pointer-events: none;
    }
  }
</style>

<div class="objects-tooltip-wrapper" class:readonly style:width use:tooltip={tooltipOptions}>
  <slot />
</div>
