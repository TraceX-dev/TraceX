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

import { DOMAIN_SPACE, type AccountUuid, type Domain, type Space } from '@hcengineering/core'
import { type MigrationClient } from '@hcengineering/model'
import { migrateSpaceDirectMembers } from '../migration'

const A = 'acc-a' as AccountUuid
const B = 'acc-b' as AccountUuid

interface Bulk {
  domain: Domain
  operations: Array<{ filter: any, update: any }>
}

/** Stores spaces in memory; traverse honours `directMembers: { $exists: false }` and the batch size. */
function createClient (spaces: Array<Partial<Space>>): {
  client: MigrationClient
  bulks: Bulk[]
  stored: Array<Partial<Space>>
} {
  const stored = spaces.map((it) => ({ ...it }))
  const bulks: Bulk[] = []
  const client = {
    traverse: async (domain: Domain, query: any) => {
      expect(domain).toBe(DOMAIN_SPACE)
      expect(query).toEqual({ directMembers: { $exists: false } })
      const pending = stored.filter((it) => it.directMembers === undefined)
      let offset = 0
      return {
        next: async (count: number) => {
          const batch = pending.slice(offset, offset + count)
          offset += count
          return batch.length === 0 ? null : batch
        },
        close: async () => {}
      }
    },
    bulk: async (domain: Domain, operations: Array<{ filter: any, update: any }>) => {
      bulks.push({ domain, operations })
      for (const { filter, update } of operations) {
        const space = stored.find((it) => it._id === filter._id)
        if (space !== undefined) Object.assign(space, update)
      }
    }
  } as unknown as MigrationClient
  return { client, bulks, stored }
}

describe('migrateSpaceDirectMembers', () => {
  it('copies members to directMembers', async () => {
    const { client, stored } = createClient([
      { _id: 'space-1' as any, members: [A, B] },
      { _id: 'space-2' as any, members: [] }
    ])
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})

    await migrateSpaceDirectMembers(client)

    expect(stored.map((it) => it.directMembers)).toEqual([[A, B], []])
    expect(stored.map((it) => it.members)).toEqual([[A, B], []])
    log.mockRestore()
  })

  it('treats missing members as empty', async () => {
    const { client, stored } = createClient([{ _id: 'space-1' as any }])
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})

    await migrateSpaceDirectMembers(client)

    expect(stored[0].directMembers).toEqual([])
    log.mockRestore()
  })

  it('skips spaces that already have directMembers and is idempotent', async () => {
    const { client, bulks, stored } = createClient([
      { _id: 'space-1' as any, members: [A, B], directMembers: [A] },
      { _id: 'space-2' as any, members: [B] }
    ])
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})

    await migrateSpaceDirectMembers(client)
    await migrateSpaceDirectMembers(client)

    expect(stored.map((it) => it.directMembers)).toEqual([[A], [B]])
    expect(bulks.flatMap((it) => it.operations.map((op) => op.filter._id))).toEqual(['space-2'])
    log.mockRestore()
  })
})
