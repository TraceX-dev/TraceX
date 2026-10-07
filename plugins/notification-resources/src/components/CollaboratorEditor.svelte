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
  import { type Employee, getGuestScopedEmployees, makePeopleScope } from '@hcengineering/contact'
  import { AccountArrayEditor, employeeRefByAccountUuidStore } from '@hcengineering/contact-resources'
  import core, { AccountUuid, Collaborator, Doc, Ref, Space } from '@hcengineering/core'
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

  $: accounts = collaborators.map((c) => c.collaborator)

  // Guests pick collaborators among the people of the object's space (and its current collaborators).
  // Undefined means no narrowing: not a guest or the context can't be resolved.
  let scopedEmployees: Employee[] | undefined = undefined
  $: void updateScopedEmployees(object)

  async function updateScopedEmployees (doc: Doc): Promise<void> {
    const space = client.getHierarchy().isDerived(doc._class, core.class.Space) ? (doc._id as Ref<Space>) : doc.space
    const employees = await getGuestScopedEmployees(client, { space, objectId: doc._id })
    if (doc !== object) return
    scopedEmployees = employees
  }

  $: includeItems = scopedEmployees?.map((it) => it._id) ?? []

  async function change (res: AccountUuid[]): Promise<void> {
    if (!canEditCollaborators) return

    const toAdd: AccountUuid[] = res.filter((a) => !accounts.includes(a))
    // Collaborators the current user can't see (e.g. hidden from guests by the server) are not shown
    // in the editor, so they are missing in `res` as well and must not be removed.
    const toRemove: Collaborator[] = collaborators.filter(
      (a) => !res.includes(a.collaborator) && $employeeRefByAccountUuidStore.has(a.collaborator)
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
  peopleScope={makePeopleScope(object.space, object._id)}
  dataId={'btnCollaborators'}
  {includeItems}
  readonly={readonly || !canEditCollaborators}
/>
