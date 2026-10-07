<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { Doc, PersonId, Ref, Space } from '@hcengineering/core'
  import contact from '@hcengineering/contact'
  import { IntlString } from '@hcengineering/platform'
  import { ButtonKind, ButtonSize, Component } from '@hcengineering/ui'

  export let label: IntlString
  export let value: PersonId[]
  export let readonly = false
  export let onChange: ((refs: PersonId[]) => void | Promise<void>) | undefined
  export let kind: ButtonKind = 'link'
  export let size: ButtonSize = 'large'
  // The edited object: guests are offered only people of it
  export let space: Ref<Space> | undefined = undefined
  export let object: Doc | undefined = undefined
</script>

<Component
  is={contact.component.PersonIdArrayEditor}
  props={{
    label,
    value,
    readonly,
    onChange,
    kind,
    size,
    space,
    object
  }}
/>
