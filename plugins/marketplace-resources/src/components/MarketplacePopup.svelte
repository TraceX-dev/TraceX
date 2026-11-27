<!--
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import type { MasterTag } from '@hcengineering/card'
  import type { Ref } from '@hcengineering/core'
  import marketplace, { type CatalogPackage } from '@hcengineering/marketplace'
  import { Dialog, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import PackageCatalog from './PackageCatalog.svelte'

  export let kind: CatalogPackage['kind']
  export let masterTag: Ref<MasterTag> | undefined = undefined

  const dispatch = createEventDispatcher<{ close: boolean }>()
</script>

<Dialog
  label={marketplace.string.FromMarketplace}
  width="48rem"
  height="min(44rem, calc(100dvh - 2rem))"
  scrollable
  padding="var(--spacing-3)"
  on:close={() => dispatch('close', false)}
>
  <svelte:fragment slot="title">
    <span class="text-sm content-dark-color">
      <Label label={kind === 'process' ? marketplace.string.ProcessBundle : marketplace.string.CardModule} />
    </span>
  </svelte:fragment>
  <PackageCatalog {kind} {masterTag} columns={1} autoFocus on:installed={() => dispatch('close', true)} />
</Dialog>
