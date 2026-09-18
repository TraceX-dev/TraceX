<!--
// Copyright © 2026 TraceX SAS
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
  import { translateCB } from '@hcengineering/platform'
  import { themeStore } from '@hcengineering/theme'

  import uiPlugin from '../../plugin'

  let text: string | undefined

  // Plugins load before the language bundles resolve, so render nothing
  // until the translation is ready rather than flashing a raw string id.
  $: translateCB(uiPlugin.string.ConnectingToWorkspace, {}, $themeStore.language, (r) => {
    text = r
  })
</script>

{#if text !== undefined}
  <span class="connection-status overflow-label">{text}</span>
{/if}

<style lang="scss">
  .connection-status {
    min-width: 0;
    font-size: 0.75rem;
    color: var(--theme-content-color);
    user-select: none;
    -webkit-user-select: none;
  }
</style>
