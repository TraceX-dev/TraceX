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
  import ui, { IconSearch } from '@hcengineering/ui'

  import { userSearch } from '../../../index'
  import Header from '../../Header.svelte'
  import MessagesBrowser from './MessagesBrowser.svelte'

  let searchValue = ''
  userSearch.subscribe((value) => (searchValue = value))
</script>

<Header
  icon={IconSearch}
  intlLabel={ui.string.Search}
  titleKind={'breadcrumbs'}
  bind:searchValue
  adaptive={'freezeActions'}
/>
<MessagesBrowser withHeader={false} search={searchValue} />
