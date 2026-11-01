<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import guest from '../plugin'
  import { checkAccess } from '../utils'
  import presentation, { decodeTokenPayload, getClient } from '@hcengineering/presentation'
  import { getMetadata } from '@hcengineering/platform'
  import { EmbeddedWorkspace } from '@hcengineering/workbench-resources'
  import { Label } from '@hcengineering/ui'

  const client = getClient()
  async function load () {
    const token = getMetadata(presentation.metadata.Token)
    if (token == null) return undefined
    const { extra } = decodeTokenPayload(token)
    if (typeof extra?.linkId !== 'string') return undefined
    return await client.findOne(guest.class.PublicLink, { _id: extra.linkId })
  }
</script>

{#await load() then link}
  {#if link !== undefined}
    <EmbeddedWorkspace target={link.location} restrictions={link.restrictions} beforeOpen={checkAccess} />
  {:else}
    <Label label={guest.string.LinkWasRevoked} />
  {/if}
{:catch}
  <Label label={guest.string.LinkWasRevoked} />
{/await}
