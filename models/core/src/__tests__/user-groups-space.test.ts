//
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
//

import core, { DOMAIN_SPACE, DOMAIN_TX, DOMAIN_USER_GROUP, type Domain } from '@hcengineering/core'
import { type MigrationClient } from '@hcengineering/model'
import { migrateUserGroupsSpace } from '../migration'

describe('migrateUserGroupsSpace', () => {
  function migrationClient (existingSpace: boolean): {
    client: MigrationClient
    updates: Array<{ domain: Domain, query: any, operations: any }>
    created: Array<{ domain: Domain, doc: any }>
  } {
    const updates: Array<{ domain: Domain, query: any, operations: any }> = []
    const created: Array<{ domain: Domain, doc: any }> = []
    const client = {
      find: async () => (existingSpace ? [{ _id: core.space.UserGroups, _class: core.class.SystemSpace }] : []),
      create: async (domain: Domain, doc: any) => {
        created.push({ domain, doc })
      },
      update: async (domain: Domain, query: any, operations: any) => {
        updates.push({ domain, query, operations })
      }
    } as unknown as MigrationClient
    return { client, updates, created }
  }

  it('creates the space before moving the groups into it', async () => {
    const { client, created } = migrationClient(false)
    await migrateUserGroupsSpace(client)
    expect(created).toHaveLength(1)
    expect(created[0].domain).toBe(DOMAIN_SPACE)
    expect(created[0].doc).toMatchObject({ _id: core.space.UserGroups, _class: core.class.SystemSpace, private: false })
  })

  it('keeps an existing space', async () => {
    const { client, created } = migrationClient(true)
    await migrateUserGroupsSpace(client)
    expect(created).toHaveLength(0)
  })

  it('moves user groups and their transactions to the space hidden from guests', async () => {
    const { client, updates } = migrationClient(true)

    await migrateUserGroupsSpace(client)

    expect(core.space.UserGroups).toBe('core:space:UserGroups')
    expect(updates).toEqual([
      {
        domain: DOMAIN_USER_GROUP,
        query: { space: core.space.Workspace },
        operations: { space: core.space.UserGroups }
      },
      {
        domain: DOMAIN_TX,
        query: { objectClass: core.class.UserGroup, objectSpace: core.space.Workspace },
        operations: { objectSpace: core.space.UserGroups }
      }
    ])
  })
})
