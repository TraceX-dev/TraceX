<!--
// Copyright © 2022 Hardcore Engineering Inc.
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
  import core, { AnyAttribute, Class, Doc, DOMAIN_STATUS, Ref, RefTo } from '@hcengineering/core'
  import { TypeRef } from '@hcengineering/model'
  import { getClient } from '@hcengineering/presentation'
  import { Component, DropdownLabelsIntl, Label, Toggle } from '@hcengineering/ui'
  import { type RefAttributeOptions } from '@hcengineering/view'
  import view from '@hcengineering/view-resources/src/plugin'
  import card from '@hcengineering/card'
  import { createEventDispatcher } from 'svelte'
  import type { ButtonKind, ButtonSize, DropdownIntlItem } from '@hcengineering/ui'
  import setting from '../../plugin'
  import RefFiltersEditor from './RefFiltersEditor.svelte'

  export let type: RefTo<Doc> | undefined
  export let attribute: AnyAttribute | undefined
  export let attributeOf: Ref<Class<Doc>>
  export let editable: boolean = true
  export let kind: ButtonKind = 'regular'
  export let size: ButtonSize = 'medium'
  export let isCard: boolean = false
  export let width: string | undefined = undefined
  // Filters and the space restriction do not affect stored values, so they stay editable
  // when the class can not be changed anymore
  export let disabled: boolean = false
  export let nested: boolean = false

  const _classes = [core.class.Doc]

  const dispatch = createEventDispatcher()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  const classes = fillClasses(_classes)

  function fillClasses (classes: Ref<Class<Doc>>[]): DropdownIntlItem[] {
    const res: DropdownIntlItem[] = []
    const descendants = new Set(classes.map((p) => hierarchy.getDescendants(p)).reduce((a, b) => a.concat(b)))
    // exclude removed card types
    const removedTypes = client.getModel().findAllSync(card.class.MasterTag, { removed: true })
    const excluded = new Set(removedTypes.map((p) => p._id))
    for (const desc of descendants) {
      if (excluded.has(desc)) continue
      const domain = hierarchy.findDomain(desc)
      if (domain === DOMAIN_STATUS || domain === undefined) continue
      if (hierarchy.classHierarchyMixin(desc, view.mixin.AttributeEditor) === undefined) continue
      const _class = hierarchy.getClass(desc)
      if (_class.label === undefined) continue
      res.push({ id: _class._id, label: _class.label })
    }
    return res
  }

  let refClass: Ref<Class<Doc>> | undefined = type?.to

  const options = (attribute ?? {}) as RefAttributeOptions
  // Filters are shown only for attributes that declare them in the model: generic reference
  // editors do not apply them, only the components that build the query with buildRefAttributeQuery
  const withFilters = !nested && (options.refFilter !== undefined || options.refSameSpace !== undefined)
  let refFilter: string | undefined = options.refFilter
  let refSameSpace: boolean = options.refSameSpace ?? false
  let previousClass = refClass

  $: selected = classes.find((p) => p.id === refClass)

  $: if (refClass !== previousClass) {
    // Filters of the previous class do not apply to the new one
    previousClass = refClass
    refFilter = refFilter !== undefined ? '' : undefined
    refSameSpace = false
  }

  $: refClass !== undefined &&
    dispatch('change', { type: TypeRef(refClass), extra: withFilters ? getOptions(refFilter, refSameSpace) : {} })

  function getOptions (refFilter: string | undefined, refSameSpace: boolean): RefAttributeOptions {
    return { refFilter, refSameSpace }
  }

  $: editor = refClass !== undefined && hierarchy.classHierarchyMixin(refClass, view.mixin.TypeEditor)?.editor
</script>

<span class="label">
  <Label label={core.string.Class} />
</span>
{#if editable}
  <DropdownLabelsIntl
    label={core.string.Class}
    items={classes}
    {width}
    bind:selected={refClass}
    {kind}
    {size}
    withSearch
  />
{:else if selected}
  <Label label={selected.label} />
{/if}
{#if withFilters && refClass !== undefined}
  <span class="label">
    <Label label={setting.string.RelationFilter} />
  </span>
  <RefFiltersEditor
    _class={refClass}
    value={refFilter}
    editable={!disabled}
    on:change={(e) => {
      refFilter = e.detail
    }}
  />
  <span class="label">
    <Label label={setting.string.RefSameSpaceOnly} />
  </span>
  <Toggle bind:on={refSameSpace} {disabled} />
{/if}
{#if editor}
  <Component is={editor} props={{ attribute, type, editable, attributeOf, isCard }} on:change />
{/if}
