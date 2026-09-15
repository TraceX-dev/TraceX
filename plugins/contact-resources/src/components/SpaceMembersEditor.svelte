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
  import { AccountUuid, getCurrentAccount, Space } from '@hcengineering/core'
  import { IntlString } from '@hcengineering/platform'
  import { Button, ButtonKind, ButtonSize } from '@hcengineering/ui'
  import { permissions } from '@hcengineering/view-resources'
  import view from '@hcengineering/view'
  import AccountArrayEditor from './AccountArrayEditor.svelte'

  export let label: IntlString
  export let object: Space
  export let value: AccountUuid[]
  export let onChange: ((refs: AccountUuid[]) => void) | undefined
  export let readonly = false
  export let kind: ButtonKind = 'link'
  export let size: ButtonSize = 'large'
  export let width: string | undefined = undefined

  const myAcc = getCurrentAccount()
  const myAccUuid = myAcc.uuid

  $: joined = value.includes(myAccUuid)
  $: canEditMembers = $permissions.canEditMembers(object)
  $: canJoin = $permissions.canJoinSpace(object)

  function join (): void {
    if (!canJoin) return
    if (value.includes(myAccUuid)) return
    if (onChange === undefined) return

    onChange([...value, myAccUuid])
  }
</script>

{#if !joined && onChange !== undefined && canJoin}
  <Button label={view.string.Join} {size} {width} kind={'primary'} on:click={join} />
{:else}
  <AccountArrayEditor
    {label}
    {value}
    {onChange}
    readonly={readonly || !canEditMembers}
    {kind}
    {size}
    {width}
    allowGuests
  />
{/if}
