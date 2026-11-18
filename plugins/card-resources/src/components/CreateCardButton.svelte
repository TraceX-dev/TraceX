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
  import { CardSpace, MasterTag } from '@hcengineering/card'
  import core, { Association, Class, Doc, Ref, getCurrentAccount } from '@hcengineering/core'
  import { ButtonIcon, getCurrentLocation, IconAdd, navigate, showPopup } from '@hcengineering/ui'
  import { getClient } from '@hcengineering/presentation'
  import card from '../plugin'
  import { getRootType, isBaseTypeWithSubtypes } from '../utils'
  import CreateCardPopup from './CreateCardPopup.svelte'

  /**
   * Relation to create between the new card and an existing one.
   * docIsA: true when docId is docA of the association (the new card becomes docB).
   */
  interface CreateCardLink {
    association: Ref<Association>
    docId: Ref<Doc>
    docIsA: boolean
  }

  export let _class: Ref<Class<Doc>> | undefined
  // Preferred space, used when it allows the type.
  export let space: Ref<CardSpace> | undefined = undefined
  export let link: CreateCardLink | undefined = undefined
  export let disabled: boolean = false
  // When set, called with the new card id instead of navigating to the card.
  export let onCreated: ((_id: Ref<Doc>) => void) | undefined = undefined

  const client = getClient()
  const hierarchy = client.getHierarchy()

  async function isSpaceAllowed (_id: Ref<CardSpace>, rootType: Ref<MasterTag>): Promise<boolean> {
    const s = await client.findOne(card.class.CardSpace, { _id })
    return s !== undefined && s.archived !== true && s.types.includes(rootType)
  }

  // Pick a space where this type can be created, so the dialog opens with the type preselected.
  async function resolveSpace (type: Ref<MasterTag>): Promise<Ref<CardSpace> | undefined> {
    const rootType = getRootType(hierarchy, type)
    const candidates: Ref<CardSpace>[] = []
    if (space !== undefined) candidates.push(space)
    if (link !== undefined) {
      const linked = await client.findOne(card.class.Card, { _id: link.docId as Ref<any> })
      if (linked !== undefined) candidates.push(linked.space as Ref<CardSpace>)
    }
    for (const candidate of candidates) {
      if (await isSpaceAllowed(candidate, rootType)) return candidate
    }
    const fallback = await client.findOne(card.class.CardSpace, {
      archived: false,
      members: getCurrentAccount().uuid,
      types: rootType
    })
    return fallback?._id ?? space
  }

  async function createRelation (_id: Ref<Doc>): Promise<void> {
    if (link === undefined) return
    await client.createDoc(core.class.Relation, core.space.Workspace, {
      association: link.association,
      docA: link.docIsA ? link.docId : _id,
      docB: link.docIsA ? _id : link.docId
    })
  }

  async function createCard (): Promise<void> {
    if (_class === undefined || disabled) return
    const type = _class as Ref<MasterTag>
    const targetSpace = await resolveSpace(type)
    showPopup(
      CreateCardPopup,
      { type, space: targetSpace, changeType: isBaseTypeWithSubtypes(hierarchy, type) },
      'center',
      async (result) => {
        if (result == null || result === '') return
        const _id = result as Ref<Doc>
        await createRelation(_id)
        if (onCreated !== undefined) {
          onCreated(_id)
          return
        }
        const loc = getCurrentLocation()
        loc.path[3] = _id
        loc.path.length = 4
        navigate(loc)
      }
    )
  }
</script>

<ButtonIcon
  kind="primary"
  icon={IconAdd}
  size="small"
  dataId="btnCreateCard"
  {disabled}
  tooltip={disabled ? { label: card.string.SelectParentFirst } : undefined}
  on:click={createCard}
/>
