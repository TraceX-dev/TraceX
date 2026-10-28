<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import attachment from '@hcengineering/attachment'
  import { FileBrowser } from '@hcengineering/attachment-resources'
  import type { Class, Ref, Space } from '@hcengineering/core'

  import { userSearch } from '../../../index'
  import plugin from '../../../plugin'
  import Header from '../../Header.svelte'

  let searchValue = ''
  userSearch.subscribe((value) => (searchValue = value))

  const requestedSpaceClasses: Array<Ref<Class<Space>>> = [plugin.class.Channel, plugin.class.DirectMessage]
</script>

<Header
  icon={attachment.icon.FileBrowser}
  intlLabel={attachment.string.Files}
  titleKind={'breadcrumbs'}
  bind:searchValue
  adaptive={'freezeActions'}
  searchSpecialId={'files'}
/>
<FileBrowser withHeader={false} isListDisplayMode={false} search={searchValue} {requestedSpaceClasses} />
