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
  import { StyledTextBox, type ImageUploadOptions } from '@hcengineering/text-editor-resources'

  export let value: string
  export let readonly: boolean = false
  export let onChange: (value: string) => void
  export let attachFile: ImageUploadOptions['attachFile'] | undefined = undefined
</script>

<StyledTextBox
  content={value}
  alwaysEdit
  previewUnlimit
  renderReadonlyEditor
  mode={2}
  isScrollable={false}
  kitOptions={{ mode: 'full', textAlign: true, drawingBoard: true, reference: true, emoji: true }}
  {readonly}
  {attachFile}
  on:value={(event) => {
    if (!readonly) onChange(event.detail)
  }}
/>
