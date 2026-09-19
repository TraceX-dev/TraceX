<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { type Employee, getGuestVisibleEmployees } from '@hcengineering/contact'
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import core, {
    AccountUuid,
    Collaborator,
    Doc,
    getCurrentAccount,
    isGuestRole,
    notEmpty,
    Ref,
    Space
  } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { permissions } from '@hcengineering/view-resources'
  import notification from '../plugin'

  export let object: Doc
  export let readonly = false

  let collaborators: Collaborator[] = []

  const query = createQuery()
  const client = getClient()

  $: canEditCollaborators = $permissions.canEditMembers(object)
  $: updateCollaboratorsQuery(object)

  function updateCollaboratorsQuery (object: Doc): void {
    query.query(
      core.class.Collaborator,
      {
        attachedTo: object._id
      },
      (res) => {
        collaborators = res
      }
    )
  }

  // Guests only see and pick collaborators who are members of the object's space.
  // Until the space is loaded a guest sees nobody and cannot edit the list.
  const isGuest = isGuestRole(getCurrentAccount().role)
  let visibleEmployees: Employee[] | undefined = isGuest ? [] : undefined
  let visibleLoaded = !isGuest

  $: void updateVisibleEmployees(object)

  async function updateVisibleEmployees (doc: Doc): Promise<void> {
    const space = client.getHierarchy().isDerived(doc._class, core.class.Space) ? (doc._id as Ref<Space>) : doc.space
    const employees = await getGuestVisibleEmployees(client, space)
    if (doc !== object) return
    visibleEmployees = employees
    visibleLoaded = true
  }

  $: visibleAccounts =
    visibleEmployees !== undefined ? new Set(visibleEmployees.map((e) => e.personUuid).filter(notEmpty)) : undefined
  $: includeItems = visibleEmployees?.map((e) => e._id) ?? []

  $: accounts = collaborators
    .map((c) => c.collaborator)
    .filter((account) => visibleAccounts === undefined || visibleAccounts.has(account))

  async function change (res: AccountUuid[]): Promise<void> {
    if (!canEditCollaborators || !visibleLoaded) return

    // Compare with all collaborators (including hidden ones) to avoid duplicates,
    // and never add accounts outside of the visible set
    const existing = new Set(collaborators.map((c) => c.collaborator))
    const toAdd: AccountUuid[] = Array.from(new Set(res)).filter(
      (a) => !existing.has(a) && (visibleAccounts === undefined || visibleAccounts.has(a))
    )
    // Hidden collaborators are never removed, only the visible ones can be changed
    const toRemove: Collaborator[] = collaborators.filter(
      (a) => accounts.includes(a.collaborator) && !res.includes(a.collaborator)
    )
    for (const account of toAdd) {
      await client.addCollection(core.class.Collaborator, object.space, object._id, object._class, 'collaborators', {
        collaborator: account
      })
    }
    for (const collaborator of toRemove) {
      await client.remove(collaborator)
    }
  }
</script>

<AccountArrayEditor
  label={notification.string.Collaborators}
  value={accounts}
  onChange={change}
  dataId={'btnCollaborators'}
  {includeItems}
  readonly={readonly || !canEditCollaborators || !visibleLoaded}
/>
