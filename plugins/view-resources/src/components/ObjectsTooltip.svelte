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
  import { createQuery } from '@hcengineering/presentation'

  import ObjectPresenter from './ObjectPresenter.svelte'

  export let objects: Doc[] = []
  export let objectIds: Ref<Doc>[] = []
  export let _class: Ref<Class<Doc>> | undefined = undefined

  let queriedObjects: Doc[] = []
  const query = createQuery()

  function orderObjects(objects: Doc[], objectIds: Ref<Doc>[]): Doc[] {
    if (objectIds.length === 0) return objects

    const objectsById = new Map(objects.map((object) => [object._id, object]))
    return objectIds
      .filter((objectId, index) => objectIds.indexOf(objectId) === index)
      .map((objectId) => objectsById.get(objectId))
      .filter((object): object is Doc => object !== undefined)
  }

  $: if (_class !== undefined && objectIds.length > 0) {
    query.query(_class, { _id: { $in: objectIds } }, (result) => {
      queriedObjects = orderObjects(result, objectIds)
    })
  } else {
    query.unsubscribe()
    queriedObjects = []
  }

  $: displayedObjects = objects.length > 0 ? orderObjects(objects, objectIds) : queriedObjects
</script>

<div class="objects-tooltip m-2 flex-col flex-gap-2">
  {#each displayedObjects as object (object._id)}
    <ObjectPresenter value={object} disabled />
  {/each}
</div>

<style lang="scss">
  .objects-tooltip {
    min-height: 0;
    overflow-y: auto;
  }
</style>
