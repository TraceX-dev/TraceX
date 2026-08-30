<!--
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
  import { adminId } from '@hcengineering/admin'
  import { Loading, location } from '@hcengineering/ui'
  import { connect } from '../connect'
  import AdminPanel from './AdminPanel.svelte'
</script>

{#if $location.path[0] === adminId}
  {#await connect()}
    <Loading />
  {:then}
    <AdminPanel />
  {:catch error}
    <div>{error.message}</div>
  {/await}
{/if}
