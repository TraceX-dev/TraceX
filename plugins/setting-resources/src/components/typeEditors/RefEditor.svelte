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
  import { Component, DropdownLabelsIntl, Label } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import card from '@hcengineering/card'
  import contact from '@hcengineering/contact'
  import setting from '../../plugin'
  import { createEventDispatcher } from 'svelte'
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

  $: selected = classes.find((p) => p.id === refClass)

  let excludedClasses: Ref<Class<Doc>>[] = type?.excludedClasses ?? []

  $: exclusionItems =
    refClass === undefined
      ? []
      : hierarchy
          .getDescendants(refClass)
          .filter((clazz) => clazz !== refClass && hierarchy.getClass(clazz).label !== undefined)
          .map((clazz) => ({ id: clazz, label: hierarchy.getClass(clazz).label }))

  function updateType (clazz: Ref<Class<Doc>>, exclusions: Ref<Class<Doc>>[]): void {
    const compatible =
      clazz === type?.to
        ? exclusions
        : exclusions.filter((excluded) => excluded !== clazz && hierarchy.isDerived(excluded, clazz))
    const nextType: RefTo<Doc> = { ...type, ...TypeRef(clazz) }
    if (compatible.length > 0) nextType.excludedClasses = compatible
    else delete nextType.excludedClasses
    dispatch('change', { type: nextType, preserveOptions: clazz === type?.to })
  }

  $: if (refClass !== undefined) updateType(refClass, excludedClasses)

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
    on:selected={() => {
      excludedClasses = excludedClasses.filter(
        (excluded) => refClass !== undefined && excluded !== refClass && hierarchy.isDerived(excluded, refClass)
      )
    }}
    {kind}
    {size}
    withSearch
  />
{:else if selected}
  <Label label={selected.label} />
{/if}
{#if refClass === contact.class.Person && exclusionItems.length > 0}
  <span class="label"><Label label={setting.string.ExcludedClassesAndMixins} /></span>
  <DropdownLabelsIntl
    label={setting.string.ExcludedClassesAndMixins}
    items={exclusionItems}
    bind:selected={excludedClasses}
    multiselect
    withSearch
    {disabled}
    shouldUpdateUndefined={false}
    dataId="reference-excluded-classes"
    {width}
    {kind}
    {size}
  />
{/if}
{#if editor}
  <Component is={editor} props={{ attribute, type, editable, attributeOf, isCard }} on:change />
{/if}
