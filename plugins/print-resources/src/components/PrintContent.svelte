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
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->

<script lang="ts">
  import type { Doc } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import type { KeyedAttribute } from '@hcengineering/presentation'
  import { CollaborativeTextEditor } from '@hcengineering/text-editor-resources'
  import { getCollaborationUser } from '@hcengineering/view-resources'

  export let object: Doc
  export let title: string

  const attribute: KeyedAttribute = {
    key: 'content',
    attr: getClient().getHierarchy().getAttribute(object._class, 'content')
  }
  const user = getCollaborationUser()
</script>

<article class="flex-col flex-gap-4 p-4">
  <h1>{title}</h1>
  <CollaborativeTextEditor
    {object}
    {attribute}
    {user}
    readonly
    withSideMenu={false}
    withInlineCommands={false}
    overflow="none"
  />
</article>
