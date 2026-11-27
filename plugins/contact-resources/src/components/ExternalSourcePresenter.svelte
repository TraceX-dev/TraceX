<!--
//
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
  import { getSocialIdByPersonIdCb } from '../utils'
  import { getExternalSource, type PersonId } from '@hcengineering/core'

  export let value: PersonId | undefined = undefined
  export let source: string | undefined = undefined
  let identitySource: string | undefined

  $: {
    const requested = value
    identitySource = undefined
    if (source === undefined && requested !== undefined) {
      getSocialIdByPersonIdCb(requested, (identity) => {
        if (value === requested) identitySource = identity == null ? undefined : getExternalSource(identity)
      })
    }
  }
</script>

{#if source ?? identitySource}
  <span class="content-dark-color overflow-label font-normal">({source ?? identitySource})</span>
{/if}
