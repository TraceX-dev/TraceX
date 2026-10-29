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

import core, {
  type AccountUuid,
  type AnyAttribute,
  type ClassCollaborators,
  type Doc,
  type MeasureContext,
  type Ref,
  type Space
} from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'

import { getRemovedMembers } from '../index'

const A = 'acc-a' as AccountUuid
const B = 'acc-b' as AccountUuid
const C = 'acc-c' as AccountUuid
const OWNER = 'acc-owner' as AccountUuid

// Both fields hold account uuids, so collaborators are resolved without any lookup.
const accountsAttr = (name: string): AnyAttribute =>
  ({ name, type: { _class: core.class.ArrOf, of: { _class: core.class.TypeAccountUuid } } }) as unknown as AnyAttribute

const ctx = {
  with: async (_name: string, _params: any, fn: (ctx: any) => any) => await fn(ctx)
} as unknown as MeasureContext

const control = {
  hierarchy: {
    findAttribute: (_class: Ref<any>, field: string) =>
      field === 'members' || field === 'owners' ? accountsAttr(field) : undefined,
    getAllAttributes: () =>
      new Map([
        ['members', accountsAttr('members')],
        ['owners', accountsAttr('owners')]
      ])
  }
} as unknown as TriggerControl

const mixin = (fields: string[], allFields?: boolean): ClassCollaborators<Doc> =>
  ({ attachedTo: core.class.Space, fields, allFields }) as unknown as ClassCollaborators<Doc>

const space = (members: AccountUuid[], owners: AccountUuid[] = []): Space =>
  ({ _id: 'space-1', _class: core.class.Space, members, owners }) as unknown as Space

describe('getRemovedMembers', () => {
  it('$pull removes the pulled member', async () => {
    const removed = await getRemovedMembers(
      ctx,
      { $pull: { members: B } },
      mixin(['members']),
      space([A]),
      [A, B],
      control
    )
    expect(removed).toEqual([B])
  })

  it('$pull $in removes all pulled members', async () => {
    const removed = await getRemovedMembers(
      ctx,
      { $pull: { members: { $in: [B, C] } } },
      mixin(['members']),
      space([A]),
      [A, B, C],
      control
    )
    expect(removed.sort()).toEqual([B, C])
  })

  it('full replacement removes collaborators absent from the new list', async () => {
    const removed = await getRemovedMembers(
      ctx,
      { members: [A, C] },
      mixin(['members']),
      space([A, C]),
      [A, B, C],
      control
    )
    expect(removed).toEqual([B])
  })

  it('full replacement with an empty list removes every collaborator', async () => {
    const removed = await getRemovedMembers(ctx, { members: [] }, mixin(['members']), space([]), [A, B], control)
    expect(removed.sort()).toEqual([A, B])
  })

  it('full replacement keeps collaborators given by other fields', async () => {
    const removed = await getRemovedMembers(
      ctx,
      { members: [A] },
      mixin(['members', 'owners']),
      space([A], [OWNER]),
      [A, B, OWNER],
      control
    )
    expect(removed).toEqual([B])
  })

  it('full replacement keeps collaborators given by other fields when all fields are tracked', async () => {
    const removed = await getRemovedMembers(
      ctx,
      { members: [A] },
      mixin([], true),
      space([A], [OWNER]),
      [A, B, OWNER],
      control
    )
    expect(removed).toEqual([B])
  })

  it('ignores members when the class does not track them', async () => {
    const removed = await getRemovedMembers(ctx, { members: [A] }, mixin(['owners']), space([A]), [A, B], control)
    expect(removed).toEqual([])
  })

  it('removes nothing for updates without member changes', async () => {
    const removed = await getRemovedMembers(ctx, { name: 'renamed' }, mixin(['members']), space([A]), [A, B], control)
    expect(removed).toEqual([])
  })
})
