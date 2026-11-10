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

import core, { type AccountUuid, type Space, type TxOperations, type UserGroup } from '@hcengineering/core'
import { recomputeSpaceMembers } from './space-members'

const A = 'acc-a' as AccountUuid
const B = 'acc-b' as AccountUuid
const G = 'acc-g' as AccountUuid

const space = (_id: string, fields: Partial<Space>): Space =>
  ({ _id, _class: 'chunter:class:Channel', name: _id, members: [], ...fields }) as unknown as Space

function createMockOps (spaces: Space[], groups: UserGroup[]): { ops: TxOperations, updates: Array<[string, any]> } {
  const updates: Array<[string, any]> = []
  const ops = {
    findAll: async (_class: string) => (_class === core.class.UserGroup ? groups : spaces),
    update: async (doc: Space, operations: any) => {
      updates.push([doc._id, operations])
    }
  } as unknown as TxOperations
  return { ops, updates }
}

describe('recomputeSpaceMembers', () => {
  const groups = [{ _id: 'g1', members: [G] } as unknown as UserGroup]
  const spaces = (): Space[] => [
    space('ok', { members: [A, G], directMembers: [A], groups: ['g1' as any] }),
    space('stray', { members: [A, B], directMembers: [A] }),
    space('missing', { members: [A], directMembers: [A], groups: ['g1' as any] }),
    space('not-migrated', { members: [A, B] })
  ]

  it('reports drift without changes in dry-run mode', async () => {
    const { ops, updates } = createMockOps(spaces(), groups)
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})

    const result = await recomputeSpaceMembers(ops, true)

    expect(result.drift.map((it) => [it.space, it.notMigrated, it.stray, it.missing])).toEqual([
      ['stray', false, [B], []],
      ['missing', false, [], [G]],
      ['not-migrated', true, [], []]
    ])
    expect(updates).toEqual([])
    log.mockRestore()
  })

  it('keeps access: stray members become direct, other spaces are rewritten to recompute', async () => {
    const { ops, updates } = createMockOps(spaces(), groups)

    const result = await recomputeSpaceMembers(ops, false)

    expect(result.fixed).toBe(3)
    expect(updates).toEqual([
      ['stray', { directMembers: [A, B] }],
      ['missing', { directMembers: [A] }],
      ['not-migrated', { directMembers: [A, B] }]
    ])
  })
})
