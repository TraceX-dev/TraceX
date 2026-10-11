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
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import contact from '@hcengineering/contact-resources/src/plugin'
  import { getClient } from '@hcengineering/presentation'
  import { Project } from '@hcengineering/tracker'
  import { permissions } from '@hcengineering/view-resources'
  export let value: Project
</script>

<AccountArrayEditor
  label={contact.string.Members}
  value={value.members}
  readonly={!$permissions.canEditMembers(value)}
  onChange={(evt) => {
    if (!$permissions.canEditMembers(value)) return
    void getClient().diffUpdate(value, { members: evt })
  }}
/>
