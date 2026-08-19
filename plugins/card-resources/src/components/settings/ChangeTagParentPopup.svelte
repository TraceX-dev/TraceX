<!--
//
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
  import { type Card as CardDoc, MasterTag, Tag } from '@hcengineering/card'
  import { type Class, type Doc, type Ref } from '@hcengineering/core'
  import presentation, { Card, getClient, MessageBox } from '@hcengineering/presentation'
  import { type DropdownIntlItem, DropdownLabelsIntl, Label, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import card from '../../plugin'

  export let tag: MasterTag

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const dispatch = createEventDispatcher()
  let selectedParent: Ref<MasterTag | Tag> | undefined = undefined

  $: selectedParent = isTagParent(tag.extends) ? tag.extends : undefined
  $: parentCandidates = getParentCandidates(tag)
  $: parentItems = parentCandidates.map((candidate) => ({ id: candidate._id, label: candidate.label }))

  function isTagParent(val: Ref<Class<Doc>> | undefined): val is Ref<MasterTag | Tag> {
    if (val === undefined) return false
    const value = hierarchy.findClass(val)
    return value?._class === card.class.MasterTag || value?._class === card.class.Tag
  }

  function getRootMasterTag(value: MasterTag): MasterTag | undefined {
    return [...hierarchy.getAncestors(value._id)]
      .map((id) => hierarchy.getClass(id))
      .find((candidate) => candidate._class === card.class.MasterTag) as MasterTag | undefined
  }

  function getParentCandidates(value: MasterTag): Array<MasterTag | Tag> {
    if (value._class !== card.class.Tag) return []

    const root = getRootMasterTag(value)
    if (root === undefined) return []

    const forbidden = new Set([value._id, ...hierarchy.getDescendants(value._id)])
    const tags = hierarchy
      .getDescendants(root._id)
      .map((id) => hierarchy.getClass(id))
      .filter((candidate): candidate is Tag => candidate._class === card.class.Tag)
      .filter((candidate) => !forbidden.has(candidate._id))
    return [root, ...tags]
  }

  async function save(): Promise<void> {
    const root = getRootMasterTag(tag)
    const isAllowedParent =
      selectedParent === undefined || parentCandidates.some((candidate) => candidate._id === selectedParent)
    const cards = await client.findAll<CardDoc>(tag._id as Ref<Class<CardDoc>>, {}, { limit: 1 })

    if (root === undefined || !isAllowedParent || cards.length > 0) {
      showPopup(MessageBox, {
        label: card.string.ChangeTagParent,
        message: card.string.ChangeTagParentBlocked
      })
      return
    }

    await client.update(tag, { extends: selectedParent ?? root._id })
    dispatch('close', { changed: true })
  }

  function handleParentChange(event: CustomEvent<DropdownIntlItem['id']>): void {
    selectedParent = event.detail as Ref<MasterTag | Tag>
  }
</script>

<Card
  label={card.string.ChangeTagParent}
  okLabel={presentation.string.Save}
  okAction={save}
  canSave
  on:close={() => dispatch('close')}
>
  <div class="flex flex-col gap-2">
    <Label label={card.string.Parent} />
    <DropdownLabelsIntl
      label={card.string.Parent}
      items={parentItems}
      selected={selectedParent}
      on:selected={handleParentChange}
    />
  </div>
</Card>
