<!--
//
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
  import { type ControlledDocument } from '@hcengineering/controlled-documents'
  import { type Ref } from '@hcengineering/core'
  import { ButtonKind, ButtonSize } from '@hcengineering/ui'
  import { ObjectBox } from '@hcengineering/view-resources'

  import documents from '../../plugin'

  export let value: Ref<ControlledDocument> | undefined
  export let readonly: boolean = false
  export let kind: ButtonKind = 'no-border'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'center'
  export let width: string | undefined = undefined
</script>

<ObjectBox
  bind:value
  _class={documents.class.ControlledDocument}
  label={documents.string.ControlledDocument}
  showNavigate={false}
  {readonly}
  {kind}
  {size}
  {justify}
  {width}
/>
