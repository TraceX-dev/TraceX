<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import core, { Ref, Space } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import presentation, { getClient } from '@hcengineering/presentation'
  import { Button, type ButtonKind, type ButtonSize, Label } from '@hcengineering/ui'
  import { ObjectPresenter } from '..'
  import ObjectsTooltipWrapper from './ObjectsTooltipWrapper.svelte'

  export let value: Ref<Space> | Ref<Space>[]
  export let inline: boolean = false
  export let accent: boolean = false
  export let shouldShowAvatar: boolean = true
  export let noUnderline: boolean = false
  export let disabled: boolean = false
  export let shouldShowName: boolean = true
  export let shrink: number = 0
  export let readonly: boolean = false
  export let label: IntlString = presentation.string.Spaces
  export let focusIndex: number | undefined = undefined
  export let kind: ButtonKind = 'ghost'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'left'
  export let width: string | undefined = 'min-content'

  const icon = getClient().getHierarchy().getClass(core.class.Space).icon
</script>

{#if Array.isArray(value)}
  <ObjectsTooltipWrapper
    selectedCount={value.length}
    objectIds={value}
    _class={core.class.Space}
    {label}
    readonly={readonly || disabled}
    {width}
  >
    <Button
      {justify}
      {focusIndex}
      width={'100%'}
      {size}
      icon={value.length === 1 ? undefined : icon}
      {kind}
      disabled={readonly || disabled}
    >
      <div slot="content" class="overflow-label">
        {#if value.length === 1}
          <ObjectPresenter
            objectId={value[0]}
            _class={core.class.Space}
            {shouldShowAvatar}
            {shouldShowName}
            disabled
            {inline}
            {noUnderline}
            {shrink}
            {accent}
            on:accent-color
          />
        {:else if value.length > 1}
          <div class="lower">{value.length} <Label {label} /></div>
        {:else}
          <Label {label} />
        {/if}
      </div>
    </Button>
  </ObjectsTooltipWrapper>
{:else}
  <ObjectPresenter
    objectId={value}
    _class={core.class.Space}
    {shouldShowAvatar}
    {shouldShowName}
    {disabled}
    {inline}
    {noUnderline}
    {shrink}
    {accent}
    on:accent-color
  />
{/if}
