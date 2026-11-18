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
  import { ReferenceFilters, supportsReferenceFilters } from '@hcengineering/view-resources'
  import { getClient } from '@hcengineering/presentation'
  import { Component, DropdownLabelsIntl, Label } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import card from '@hcengineering/card'
  import { createEventDispatcher } from 'svelte'
  import setting from '../../plugin'
  import type { ButtonKind, ButtonSize, DropdownIntlItem } from '@hcengineering/ui'

  export let type: RefTo<Doc> | undefined
  export let attribute: AnyAttribute | undefined
  export let attributeOf: Ref<Class<Doc>>
  export let editable: boolean = true
  export let disabled: boolean = false
  export let kind: ButtonKind = 'regular'
  export let size: ButtonSize = 'medium'
  export let isCard: boolean = false
  export let width: string | undefined = undefined

  const _classes = [core.class.Doc]

  const dispatch = createEventDispatcher<{ change: { type: RefTo<Doc>, preserveOptions: boolean, valid: boolean } }>()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  const removedClasses = new Set(
    client
      .getModel()
      .findAllSync(card.class.MasterTag, { removed: true })
      .map((clazz) => clazz._id)
  )
  const classes = fillClasses(_classes)

  function fillClasses (classes: Ref<Class<Doc>>[]): DropdownIntlItem[] {
    const res: DropdownIntlItem[] = []
    const descendants = new Set(classes.map((p) => hierarchy.getDescendants(p)).reduce((a, b) => a.concat(b)))
    for (const desc of descendants) {
      if (removedClasses.has(desc)) continue
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

  $: selected = classes.find((p) => p.id === refClass)

  let filters = type?._class === core.class.RefTo ? type.filters : undefined
  let filtersValid = true

  $: filtersSupported = refClass !== undefined && supportsReferenceFilters(hierarchy, refClass)
  $: if (!filtersSupported) {
    filters = undefined
    filtersValid = true
  }

  function updateType (clazz: Ref<Class<Doc>>, filters: string | undefined, valid: boolean): void {
    const nextType: RefTo<Doc> = type?._class === core.class.RefTo ? { ...type, ...TypeRef(clazz) } : TypeRef(clazz)
    if (filters !== undefined) nextType.filters = filters
    else delete nextType.filters
    dispatch('change', { type: nextType, preserveOptions: clazz === type?.to, valid })
  }

  $: if (refClass !== undefined) updateType(refClass, filters, filtersValid)

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
{#if refClass !== undefined && filtersSupported}
  <span class="label">
    <Label label={setting.string.RelationFilter} />
  </span>
  <div class="reference-filters">
    {#key refClass}
      <ReferenceFilters
        _class={refClass}
        value={filters}
        {disabled}
        on:change={(event) => {
          filters = event.detail.value
          filtersValid = event.detail.valid
        }}
      />
    {/key}
  </div>
{/if}
{#if editor}
  <Component is={editor} props={{ attribute, type, editable, attributeOf, isCard }} on:change />
{/if}

<style lang="scss">
  .reference-filters {
    min-width: 0;
  }
</style>
