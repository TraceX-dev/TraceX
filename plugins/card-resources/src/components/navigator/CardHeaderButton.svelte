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
  import { AccountRole, getCurrentAccount, hasAccountRole, isId, Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { ButtonIcon, getCurrentLocation, IconAdd, location, Menu, navigate, showPopup } from '@hcengineering/ui'

  import { Card, CardSpace, MasterTag } from '@hcengineering/card'
  import card from '../../plugin'
  import CreateSpace from './CreateSpace.svelte'
  import CreateCardPopup from '../CreateCardPopup.svelte'
  import { isBaseTypeWithSubtypes } from '../../utils'

  const me = getCurrentAccount()
  const client = getClient()

  let pressed: boolean = false

  let _class: Ref<MasterTag> | undefined
  let space: Ref<CardSpace> | undefined

  // Guards against an older lookup resolving after the location has already moved on
  let contextRequest = 0

  $: void updateContext($location.path[3], $location.path[4] as Ref<MasterTag> | undefined)

  async function updateContext (pathId: string | undefined, pathClass: Ref<MasterTag> | undefined): Promise<void> {
    const requestId = ++contextRequest

    if (pathClass !== undefined) {
      _class = pathClass
      if (pathId !== 'type') {
        space = pathId as Ref<CardSpace>
      }
      return
    }

    if (pathId === undefined || !isId(pathId)) {
      return
    }

    const doc = await client.findOne(card.class.Card, { _id: pathId as Ref<Card> })
    if (requestId !== contextRequest) return // location changed again while awaiting

    if (doc !== undefined) {
      _class = doc._class
      space = doc.space as Ref<CardSpace>
    }
  }

  async function navigateToCard (cardId: string): Promise<void> {
    const loc = getCurrentLocation()
    loc.path[3] = cardId
    loc.path.length = 4
    navigate(loc)
  }

  async function handleCreateCard (): Promise<void> {
    const changeType = _class !== undefined && isBaseTypeWithSubtypes(client.getHierarchy(), _class)
    showPopup(CreateCardPopup, { type: _class, space, changeType }, 'center', async (result) => {
      if (result != null && result !== '') {
        await navigateToCard(result)
      }
    })
  }

  async function newTeamspace (): Promise<void> {
    showPopup(CreateSpace, {}, 'top')
  }

  const globalActions = hasAccountRole(me, AccountRole.User)
    ? [
        {
          label: card.string.CreateCard,
          icon: IconAdd,
          action: handleCreateCard
        },
        {
          label: card.string.CreateSpace,
          icon: IconAdd,
          action: newTeamspace
        }
      ]
    : [
        {
          label: card.string.CreateCard,
          icon: IconAdd,
          action: handleCreateCard
        }
      ]

  function addButtonClicked (ev: MouseEvent): void {
    pressed = true
    showPopup(Menu, { actions: globalActions }, ev.target as HTMLElement, () => {
      pressed = false
    })
  }
</script>

<ButtonIcon icon={IconAdd} hasMenu {pressed} kind={'primary'} size={'small'} on:click={addButtonClicked} />
