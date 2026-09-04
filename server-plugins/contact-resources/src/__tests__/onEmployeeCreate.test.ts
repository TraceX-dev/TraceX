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

/**
 * Regression tests for `OnEmployeeCreate`'s guest-provisioning branch.
 *
 * The branch used to blanket-copy `readOnlyGuestAccountUuid`'s space membership (the "Spaces
 * visible to anonymous" setting, Settings → Guest permissions → Anonymous tab) onto every newly
 * created named Guest account. That setting is documented as governing only the shared read-only
 * anonymous session, not named guest invites - named guests are meant to be scoped by
 * `Space.autoJoinForRoles` (the "Guest" tab's "Auto-join spaces" control) and by explicit grants
 * (`PermissionsGrant`). Copying it let a guest inherit access to any space ever marked
 * anonymous-visible, which is how e.g. a "Products" card space leaked into a guest's @-mention
 * results even with guest auto-join turned off for that space.
 */

import chunter from '@hcengineering/chunter'
import contact, { type Employee, type Person } from '@hcengineering/contact'
import core, {
  AccountRole,
  generateId,
  readOnlyGuestAccountUuid,
  TxFactory,
  type AccountUuid,
  type Class,
  type Doc,
  type DocumentQuery,
  type PermissionsGrant,
  type Ref,
  type Space,
  type Tx,
  type TxMixin,
  type TxUpdateDoc
} from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'

import { OnEmployeeCreate } from '../index'

interface MockSpace {
  _id: Ref<Space>
  _class: Ref<Class<Space>>
  members: AccountUuid[]
  autoJoin?: boolean
  autoJoinForRoles?: AccountRole[]
  private?: boolean
}

function createControl (
  spaces: MockSpace[],
  person: Person & { role: string },
  grant?: PermissionsGrant
): TriggerControl {
  const applied: Tx[] = []

  const findAll = jest.fn(
    async (_ctx: any, _class: Ref<Class<Doc>>, query: DocumentQuery<Doc>, _options?: any): Promise<any[]> => {
      if (_class === contact.class.Person) {
        return [person].filter((p) => (query as any)._id === undefined || p._id === (query as any)._id)
      }
      if (_class === contact.class.PersonSpace) {
        return []
      }
      if (_class === core.class.Space) {
        const idIn = (query as any)._id?.$in as Array<Ref<Space>> | undefined
        if (idIn !== undefined) {
          return spaces.filter((s) => idIn.includes(s._id))
        }
        const autoJoinForRoles = (query as any).autoJoinForRoles as AccountRole | undefined
        if (autoJoinForRoles !== undefined) {
          return spaces.filter((s) => s.autoJoinForRoles?.includes(autoJoinForRoles) === true)
        }
        const autoJoin = (query as any).autoJoin as boolean | undefined
        if (autoJoin !== undefined) {
          return spaces.filter((s) => s.autoJoin === autoJoin)
        }
        return []
      }
      if (_class === core.class.TypedSpace || _class === (core.class.Space as any)) {
        return []
      }
      return []
    }
  )

  return {
    ctx: {
      contextData: { account: { uuid: generateId() as unknown as AccountUuid, role: AccountRole.User }, grant },
      warn: jest.fn()
    } as any,
    findAll,
    apply: jest.fn(async (_ctx: any, txes: Tx[]) => {
      applied.push(...txes)
      return {}
    }),
    txFactory: new TxFactory(core.account.System),
    hierarchy: {
      as: (doc: any) => doc,
      isDerived: (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) => a === b
    },
    __applied: applied
  } as unknown as TriggerControl & { __applied: Tx[] }
}

function employeeCreateTx (personId: Ref<Person>): Tx {
  const tx: Partial<TxMixin<Person, Employee>> = {
    _id: generateId(),
    _class: core.class.TxMixin,
    space: core.space.Tx,
    objectId: personId,
    objectClass: contact.class.Person,
    objectSpace: contact.space.Contacts,
    mixin: contact.mixin.Employee,
    attributes: { active: true },
    modifiedBy: core.account.System,
    modifiedOn: Date.now()
  }
  return tx as Tx
}

function memberAdds (control: TriggerControl, account: AccountUuid): Array<TxUpdateDoc<Space>> {
  const applied = (control as any).__applied as Tx[]
  return applied.filter(
    (t) => t._class === core.class.TxUpdateDoc && (t as TxUpdateDoc<Space>).operations.$push?.members === account
  ) as Array<TxUpdateDoc<Space>>
}

describe('OnEmployeeCreate – guest space provisioning', () => {
  const personId = generateId<Person>()
  const account = generateId() as unknown as AccountUuid

  function guestPerson (): Person & { role: string } {
    return { _id: personId, personUuid: account, role: 'GUEST' } as unknown as Person & { role: string }
  }

  it('does not grant a space that is only visible to the anonymous read-only account', async () => {
    const anonymousOnlySpace: MockSpace = {
      _id: generateId(),
      _class: core.class.Space,
      members: [readOnlyGuestAccountUuid]
    }
    const control = createControl([anonymousOnlySpace], guestPerson())

    await OnEmployeeCreate([employeeCreateTx(personId)], control)

    expect(memberAdds(control, account)).toHaveLength(0)
  })

  it('grants a space with autoJoinForRoles including Guest', async () => {
    const guestAutoJoinSpace: MockSpace = {
      _id: generateId(),
      _class: core.class.Space,
      members: [],
      autoJoinForRoles: [AccountRole.Guest]
    }
    const control = createControl([guestAutoJoinSpace], guestPerson())

    await OnEmployeeCreate([employeeCreateTx(personId)], control)

    const adds = memberAdds(control, account)
    expect(adds).toHaveLength(1)
    expect(adds[0].objectId).toBe(guestAutoJoinSpace._id)
  })

  it('does not grant a DirectMessage space even if it has autoJoinForRoles Guest', async () => {
    const dmSpace: MockSpace = {
      _id: generateId(),
      _class: chunter.class.DirectMessage,
      members: [],
      autoJoinForRoles: [AccountRole.Guest]
    }
    const control = createControl([dmSpace], guestPerson())

    await OnEmployeeCreate([employeeCreateTx(personId)], control)

    expect(memberAdds(control, account)).toHaveLength(0)
  })

  it('does not re-add a space the guest is already a member of', async () => {
    const guestAutoJoinSpace: MockSpace = {
      _id: generateId(),
      _class: core.class.Space,
      members: [account],
      autoJoinForRoles: [AccountRole.Guest]
    }
    const control = createControl([guestAutoJoinSpace], guestPerson())

    await OnEmployeeCreate([employeeCreateTx(personId)], control)

    expect(memberAdds(control, account)).toHaveLength(0)
  })

  it('grants a space explicitly listed in the invite grant', async () => {
    const grantedSpace: MockSpace = {
      _id: generateId(),
      _class: core.class.Space,
      members: [],
      private: false
    }
    const control = createControl([grantedSpace], guestPerson(), { spaces: [grantedSpace._id] })

    await OnEmployeeCreate([employeeCreateTx(personId)], control)

    const adds = memberAdds(control, account)
    expect(adds).toHaveLength(1)
    expect(adds[0].objectId).toBe(grantedSpace._id)
  })

  it('combines grant spaces and auto-join spaces without duplicating either', async () => {
    const grantedSpace: MockSpace = { _id: generateId(), _class: core.class.Space, members: [], private: false }
    const guestAutoJoinSpace: MockSpace = {
      _id: generateId(),
      _class: core.class.Space,
      members: [],
      autoJoinForRoles: [AccountRole.Guest]
    }
    const anonymousOnlySpace: MockSpace = {
      _id: generateId(),
      _class: core.class.Space,
      members: [readOnlyGuestAccountUuid]
    }
    const control = createControl([grantedSpace, guestAutoJoinSpace, anonymousOnlySpace], guestPerson(), {
      spaces: [grantedSpace._id]
    })

    await OnEmployeeCreate([employeeCreateTx(personId)], control)

    const adds = memberAdds(control, account)
    expect(adds.map((a) => a.objectId).sort()).toEqual([grantedSpace._id, guestAutoJoinSpace._id].sort())
  })
})
