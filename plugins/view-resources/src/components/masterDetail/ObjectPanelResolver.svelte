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
  import { Class, Doc, Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { Component } from '@hcengineering/ui'
  import view from '@hcengineering/view'

  export let _id: Ref<Doc> | undefined = undefined
  export let _class: Ref<Class<Doc>>
  export let readonly: boolean = false
  export let embedded: boolean = false
  export let compactMode: boolean = false

  const hierarchy = getClient().getHierarchy()

  $: component = hierarchy.classHierarchyMixin(_class, view.mixin.ObjectPanel)?.component ?? view.component.EditDoc
</script>

{#if _id !== undefined}
  <Component is={component} props={{ _id, _class, readonly, embedded, compactMode }} />
{/if}
