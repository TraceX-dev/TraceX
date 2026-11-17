<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
    Association,
    Doc,
    DocumentQuery,
    FindOptions,
    Ref,
    Relation,
    Space,
    WithLookup,
    mergeQueries
  } from '@hcengineering/core'
  import { MasterDetailConfig, ViewOptions, Viewlet, ViewletDescriptor } from '@hcengineering/view'
  import { createQuery, getClient } from '@hcengineering/presentation'

  import MasterDetailBrowser from './MasterDetailBrowser.svelte'
  import ObjectPanelResolver from './ObjectPanelResolver.svelte'
  import view from '../../plugin'

  /**
   * Relation to create for cards created from a column.
   * docIsA: true when docId is docA of the association.
   */
  interface CreateLink {
    association: Ref<Association>
    docId: Ref<Doc>
    docIsA: boolean
  }

  export let space: Ref<Space> | undefined = undefined
  export let query: DocumentQuery<Doc> = {}
  export let options: FindOptions<Doc> | undefined = undefined
  export let viewlet: WithLookup<Viewlet>
  export let compactMode: boolean = false
  export let readonly: boolean = false
  export let reorderable: boolean = false
  // Set by the parent level of a 3+ column view.
  export let isChildLevel: boolean = false
  // Filter for the master column, coming from the selection in the parent level.
  export let masterFilter: DocumentQuery<Doc> | undefined = undefined
  // Link for cards created in the master column (selected item of the parent level).
  export let parentLink: CreateLink | undefined = undefined

  // Per _class configuration, if supported.
  export let viewOptions: ViewOptions

  let _id: Ref<Doc> | undefined = undefined
  let _query: DocumentQuery<Doc> = {}

  let parentView: ViewletDescriptor | undefined = undefined
  let detailView: ViewletDescriptor | undefined = undefined

  let selectedMaster: Ref<Doc> | undefined = undefined
  let masterSelectId: Ref<Doc> | undefined = undefined
  let association: Association | undefined = undefined
  // true when the master class is classA of the association
  let masterIsA: boolean = true

  const client = getClient()
  const relationsQuery = createQuery()

  $: views = (viewlet?.masterDetailOptions?.views ?? []) as MasterDetailConfig[]
  async function getViewlets (configs: MasterDetailConfig[]): Promise<void> {
    if (configs.length < 2) return
    const results = await client.findAll(view.class.ViewletDescriptor, {
      _id: { $in: [configs[0].view, configs[1].view] }
    })
    parentView = results.find((v) => v._id === configs[0].view)
    detailView = results.find((v) => v._id === configs[1].view)
    await findAssociation(configs)
  }

  async function findAssociation (configs: MasterDetailConfig[]): Promise<void> {
    const masterClass = configs[0].class
    const detailClass = configs[1].class
    const configured = configs[1].associationId as Ref<Association> | undefined
    let result =
      configured !== undefined ? await client.findOne(core.class.Association, { _id: configured }) : undefined
    result =
      result ??
      (await client.findOne(core.class.Association, { classA: masterClass, classB: detailClass })) ??
      (await client.findOne(core.class.Association, { classA: detailClass, classB: masterClass }))
    association = result
    masterIsA = result === undefined || result.classA === masterClass
  }

  $: void getViewlets(views)

  $: isDocumentDetail = detailView?._id === view.viewlet.Document

  function selected (e: CustomEvent<any>): void {
    selectedMaster = e.detail
    if (isDocumentDetail) {
      _id = e.detail
    }
  }

  // Live list of cards related to the selected master: refreshes when a related card is created.
  $: if (!isDocumentDetail && association !== undefined && selectedMaster !== undefined) {
    relationsQuery.query(
      core.class.Relation,
      {
        association: association._id,
        [masterIsA ? 'docA' : 'docB']: selectedMaster
      } as unknown as DocumentQuery<Relation>,
      (relations: Relation[]) => {
        const ids = relations.map((r) => (masterIsA ? r.docB : r.docA))
        _query = mergeQueries(query ?? {}, { _id: { $in: ids } })
      }
    )
  } else {
    relationsQuery.unsubscribe()
  }

  $: detailLink =
    association !== undefined && selectedMaster !== undefined
      ? { association: association._id, docId: selectedMaster, docIsA: masterIsA }
      : undefined

  // Detail cards appear through the live relations query: stay in the view instead of navigating.
  function noop (): void {}

  function onMasterCreated (id: Ref<Doc>): void {
    masterSelectId = id
  }

  $: remainingViews = views.slice(1)
  $: isSimpleView = views.length <= 2
  $: detailViewComponent = isSimpleView
    ? isDocumentDetail
      ? ObjectPanelResolver
      : (detailView?.component ?? view.component.EditDoc)
    : (viewlet?.$lookup?.descriptor?.component ?? view.component.MasterDetailBrowser)
  $: nestedViewlet = isSimpleView
    ? undefined
    : {
        ...viewlet,
        masterDetailOptions: {
          ...viewlet?.masterDetailOptions,
          views: remainingViews
        }
      }
  $: detailProps = isSimpleView
    ? {
        _class: views[1]?.class,
        space,
        options,
        config: viewlet.config,
        viewlet,
        viewOptions,
        viewOptionsConfig: viewlet.viewOptions?.other,
        totalQuery: _query,
        ...viewlet.props,
        embedded: true,
        compactMode,
        _id
      }
    : {
        space,
        options,
        viewlet: nestedViewlet,
        viewOptions,
        readonly,
        reorderable,
        isChildLevel: true,
        masterFilter: selectedMaster !== undefined ? _query : undefined,
        parentLink: detailLink
      }
  $: masterQuery = masterFilter !== undefined ? mergeQueries(query ?? {}, masterFilter) : query
  // In a child level the master column holds related cards, so creating requires a selected parent.
  $: masterCreateDisabled = isChildLevel && parentLink === undefined
</script>

{#if viewlet !== undefined && parentView !== undefined && detailView !== undefined && viewlet.masterDetailOptions !== undefined}
  <MasterDetailBrowser
    query={_query}
    {masterQuery}
    {space}
    detailComponent={detailViewComponent}
    detailComponentProps={detailProps}
    masterComponent={parentView.component}
    masterComponentProps={{
      _class: views[0].class,
      // Nested tree: child cards (parent field) are shown under their parent.
      plainList: false,
      readonly,
      reorderable,
      selectId: masterSelectId
    }}
    createMasterComponent={views[0]?.createComponent}
    createMasterComponentProps={{
      _class: views[0].class,
      space,
      link: parentLink,
      disabled: masterCreateDisabled,
      onCreated: onMasterCreated
    }}
    createDetailComponent={isDocumentDetail ? undefined : views[1]?.createComponent}
    createDetailComponentProps={{
      _class: views[1].class,
      space,
      link: detailLink,
      disabled: detailLink === undefined,
      onCreated: noop
    }}
    detailClass={views[1].class}
    parentClass={views[0].class}
    isNested={!isSimpleView}
    on:select={selected}
  />
{/if}
