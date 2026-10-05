<!--
// Copyright © 2022, 2023 Hardcore Engineering Inc.
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
  import core, {
    getObjectValue,
    mergeQueries,
    type Class,
    type Doc,
    type DocumentQuery,
    type FindOptions,
    type Ref,
    type VersionableDoc
  } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import presentation, { searchFor, type SearchItem } from '..'
  import { ObjectCreate, type ObjectSearchCategory } from '../types'
  import { createQuery, getClient } from '../utils'
  import DocPopup from './DocPopup.svelte'

  export let _class: Ref<Class<Doc>>
  export let options: FindOptions<Doc> | undefined = undefined
  export let selected: Ref<Doc> | undefined = undefined

  export let docQuery: DocumentQuery<Doc> | undefined = undefined

  export let multiSelect: boolean = false
  export let closeAfterSelect: boolean = true
  export let allowDeselect: boolean = false
  export let titleDeselect: IntlString | undefined = undefined
  export let placeholder: IntlString = presentation.string.Search
  export let selectedObjects: Ref<Doc>[] = []
  export let ignoreObjects: Ref<Doc>[] = []
  export let shadows: boolean = true
  export let width: 'medium' | 'large' | 'full' | 'auto' = 'medium'
  export let size: 'small' | 'medium' | 'large' = 'large'

  export let searchMode: 'field' | 'fulltext' | 'disabled' | 'spotlight' = 'field'
  export let category: Ref<ObjectSearchCategory> | undefined = undefined
  export let searchField: string = 'name'
  export let groupBy = '_class'

  export let create: ObjectCreate | undefined = undefined
  export let readonly = false
  export let disallowDeselect: Ref<Doc>[] | undefined = undefined
  export let embedded: boolean = false
  export let loading: boolean = false
  export let type: 'text' | 'object' | 'presenter' = 'text'
  export let showVersions: boolean = false
  export let versionsQuery: DocumentQuery<Doc> | undefined = undefined
  export let forceShowSelected: boolean = true

  export let onSelect: ((doc: Doc) => void) | undefined = undefined

  export let filter: (it: Doc) => boolean = () => {
    return true
  }

  export let sort: <T extends Doc>(a: T, b: T) => number = (a, b) => {
    const aval: string = `${getObjectValue(groupBy, a as any)}`
    const bval: string = `${getObjectValue(groupBy, b as any)}`
    return aval.localeCompare(bval)
  }

  const created: Doc[] = []
  const dispatch = createEventDispatcher()

  let noSearchField: boolean = false
  let search: string = ''
  let objects: Doc[] = []
  let selObjects: Doc[] = []
  let selectedDoc: Doc | undefined
  let resObjects: Doc[] = []

  let extraItems: Ref<Doc>[] = []

  const query = createQuery()
  const sQuery = createQuery() // Query for selected objects
  const selectedQuery = createQuery()

  $: noSearchField = searchMode === 'disabled'
  $: _idExtra = typeof docQuery?._id === 'object' ? docQuery?._id : {}
  $: if (searchMode === 'spotlight' && search !== '') {
    void searchSpotlight(search).then((items) => {
      extraItems = items.map((it) => it.item.id)
    })
  } else {
    extraItems = []
  }

  $: fquery = {
    ...(docQuery ?? {}),
    ...(() => {
      switch (searchMode) {
        case 'disabled':
          return { _id: { $nin: ignoreObjects, ..._idExtra } }
        case 'fulltext':
          return search !== ''
            ? { $search: search, _id: { $nin: ignoreObjects, ..._idExtra } }
            : { _id: { $nin: ignoreObjects, ..._idExtra } }
        case 'spotlight':
          return extraItems.length > 0
            ? { _id: { $in: extraItems, $nin: ignoreObjects } }
            : { _id: { $nin: ignoreObjects, ..._idExtra } }
        default:
          return search !== ''
            ? { [searchField]: { $like: '%' + search + '%' }, _id: { $nin: ignoreObjects, ..._idExtra } }
            : { _id: { $nin: ignoreObjects, ..._idExtra } }
      }
    })()
  }

  $: query.query<Doc>(
    _class,
    fquery,
    (result) => {
      result.sort(sort)
      resObjects = result
    },
    { ...(options ?? {}), limit: 200 }
  )

  $: if (selectedObjects.length > 0) {
    sQuery.query<Doc>(
      _class,
      search !== ''
        ? { [searchField]: { $like: '%' + search + '%' }, _id: { $in: selectedObjects } }
        : { _id: { $in: selectedObjects } },
      (result) => {
        result.sort(sort)
        selObjects = result
      },
      {}
    )
  } else {
    selObjects = []
    sQuery.unsubscribe()
  }

  $: if (showVersions && selected !== undefined) {
    selectedQuery.query<Doc>(_class, { _id: selected }, (result) => {
      selectedDoc = result[0]
    })
  } else {
    selectedQuery.unsubscribe()
    selectedDoc = undefined
  }

  $: {
    if (created.length > 0 || selObjects.length > 0) {
      const docIds = new Set(resObjects.map((it) => it._id))
      const selectedOb = forceShowSelected ? selObjects : selObjects.filter((p) => docIds.has(p._id))
      const cmap = new Set(created.map((it) => it._id))
      const smap = new Set(selObjects.map((it) => it._id))

      objects = [...created, ...selectedOb, ...resObjects.filter((d) => !cmap.has(d._id) && !smap.has(d._id))].filter(
        filter
      )
    } else {
      objects = resObjects.filter(filter)
    }
  }

  $: displayedObjects = showVersions ? groupVersions(objects) : objects
  $: selectedVersionBaseIds = [...(selectedDoc !== undefined ? [selectedDoc] : []), ...selObjects].map(
    (doc) => (doc as VersionableDoc).baseId ?? doc._id
  )
  $: versionSelectionQuery = mergeQueries(versionsQuery ?? docQuery ?? {}, { _id: { $nin: ignoreObjects } })

  function groupVersions (docs: Doc[]): Doc[] {
    const hierarchy = getClient().getHierarchy()
    const groups = new Map<Ref<Doc>, Doc>()
    for (const doc of docs) {
      const versionedDoc = doc as VersionableDoc
      const versioningEnabled = hierarchy.classHierarchyMixin(doc._class, core.mixin.VersionableClass)?.enabled
      const key = versioningEnabled === true ? (versionedDoc.baseId ?? doc._id) : doc._id
      const existing = groups.get(key) as VersionableDoc | undefined
      if (
        existing === undefined ||
        (versionedDoc.isLatest === true && existing.isLatest !== true) ||
        ((versionedDoc.isLatest === true) === (existing.isLatest === true) &&
          (versionedDoc.version ?? 0) > (existing.version ?? 0))
      ) {
        groups.set(key, doc)
      }
    }
    return Array.from(groups.values())
  }

  async function searchSpotlight (search: string): Promise<SearchItem[]> {
    return (await searchFor('spotlight', search, category, 50)).items
  }
</script>

<DocPopup
  {_class}
  objects={displayedObjects}
  {selectedVersionBaseIds}
  versionsQuery={versionSelectionQuery}
  {selected}
  {multiSelect}
  {closeAfterSelect}
  {allowDeselect}
  {titleDeselect}
  {placeholder}
  {selectedObjects}
  {shadows}
  {width}
  {size}
  {noSearchField}
  {groupBy}
  {create}
  {readonly}
  {disallowDeselect}
  {embedded}
  {loading}
  {type}
  {showVersions}
  {onSelect}
  on:update={(e) => {
    selectedObjects = Array.isArray(e.detail) ? e.detail : [e.detail._id]
    dispatch('update', e.detail)
  }}
  on:close
  on:changeContent
  on:search={(e) => (search = e.detail)}
  on:created={(doc) => {
    created.push(doc.detail)
    if (!multiSelect) dispatch('created', doc.detail)
  }}
  {created}
>
  <svelte:fragment slot="item" let:item>
    {#if $$slots.item}
      <slot name="item" {item} />
    {/if}
  </svelte:fragment>
  <svelte:fragment slot="category" let:item let:isSelected>
    {#if created.length > 0 && created.includes(item._id)}
      <div class="menu-group__header">
        <span class="overflow-label">
          <Label label={presentation.string.Created} />
        </span>
      </div>
    {:else if isSelected}
      <div class="menu-group__header">
        <span class="overflow-label">
          <Label label={presentation.string.Selected} />
        </span>
      </div>
    {:else if $$slots.category}
      <slot name="category" {item} />
    {/if}
  </svelte:fragment>
</DocPopup>
