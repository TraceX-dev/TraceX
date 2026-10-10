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

import contact, { AvatarType, combineName, type Person, type SocialIdentity } from '@hcengineering/contact'
import core, {
  type Client,
  type Person as GlobalPerson,
  type PersonId,
  type PersonUuid,
  type Ref,
  type SocialId,
  type TxApplyIf,
  SocialIdType
} from '@hcengineering/core'
import { ensureFormAuthor } from '../forms-author'

const profile: GlobalPerson = { uuid: 'global-person' as PersonUuid, firstName: 'Alice', lastName: 'Visitor' }
const social: SocialId = {
  _id: 'verified-email' as PersonId,
  type: SocialIdType.EMAIL,
  value: 'alice@example.com',
  key: 'email:alice@example.com',
  verifiedOn: 123
}
const person: Person = {
  _id: 'existing-person' as Ref<Person>,
  _class: contact.class.Person,
  space: contact.space.Contacts,
  modifiedBy: core.account.System,
  modifiedOn: 1,
  personUuid: profile.uuid,
  name: combineName('Local', 'Name'),
  avatarType: AvatarType.COLOR
}
const identity: SocialIdentity = {
  ...social,
  _id: social._id as SocialIdentity['_id'],
  _class: contact.class.SocialIdentity,
  space: contact.space.Contacts,
  modifiedBy: core.account.System,
  modifiedOn: 1,
  attachedTo: person._id,
  attachedToClass: contact.class.Person,
  collection: 'socialIds',
  isDeleted: false
}

function mockClient (): jest.Mocked<Pick<Client, 'findOne' | 'tx'>> {
  return { findOne: jest.fn(), tx: jest.fn().mockResolvedValue({ success: true, serverTime: 0 }) }
}

describe('public form author contact', () => {
  it('creates an ordinary contact and verified identity together without employee or membership writes', async () => {
    const client = mockClient()
    const ref = await ensureFormAuthor(client, profile, social)
    const apply = client.tx.mock.calls[0][0] as TxApplyIf
    expect(apply.notMatch).toEqual([
      { _class: contact.class.Person, query: { personUuid: profile.uuid } },
      { _class: contact.class.SocialIdentity, query: { _id: social._id } }
    ])
    expect(apply.txes).toHaveLength(2)
    expect(apply.txes.map((tx) => tx.objectClass)).toEqual([contact.class.Person, contact.class.SocialIdentity])
    expect(apply.txes[0]).toMatchObject({
      _class: core.class.TxCreateDoc,
      objectId: ref,
      attributes: { personUuid: profile.uuid, name: combineName(profile.firstName, profile.lastName) }
    })
    expect(apply.txes[1]).toMatchObject({
      _class: core.class.TxCreateDoc,
      objectId: social._id,
      attachedTo: ref,
      collection: 'socialIds',
      attributes: { type: social.type, value: social.value, verifiedOn: social.verifiedOn, isDeleted: false }
    })
  })

  it('reuses an existing contact without updating its name, role or employee state', async () => {
    const client = mockClient()
    client.findOne.mockResolvedValueOnce(person).mockResolvedValueOnce(identity).mockResolvedValueOnce(person)
    expect(await ensureFormAuthor(client, profile, social)).toBe(person._id)
    expect(client.tx).not.toHaveBeenCalled()
  })

  it('adds the verified identity to an existing person without creating a duplicate contact', async () => {
    const client = mockClient()
    client.findOne.mockResolvedValueOnce(person).mockResolvedValueOnce(undefined)
    expect(await ensureFormAuthor(client, profile, social)).toBe(person._id)
    const apply = client.tx.mock.calls[0][0] as TxApplyIf
    expect(apply.txes).toHaveLength(1)
    expect(apply.txes[0]).toMatchObject({ objectClass: contact.class.SocialIdentity, attachedTo: person._id })
  })

  it('links a legacy contact through its existing identity instead of creating another person', async () => {
    const client = mockClient()
    const legacy: Person = { ...person, personUuid: undefined }
    client.findOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce(identity).mockResolvedValueOnce(legacy)
    expect(await ensureFormAuthor(client, profile, social)).toBe(person._id)
    const apply = client.tx.mock.calls[0][0] as TxApplyIf
    expect(apply.txes).toHaveLength(1)
    expect(apply.txes[0]).toMatchObject({
      _class: core.class.TxUpdateDoc,
      objectId: person._id,
      operations: { personUuid: profile.uuid }
    })
  })

  it('resolves the winning contact after a concurrent submission', async () => {
    const client = mockClient()
    client.tx.mockResolvedValueOnce({ success: false, serverTime: 0 })
    client.findOne
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(person)
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(person)
    expect(await ensureFormAuthor(client, profile, social)).toBe(person._id)
    expect(client.tx).toHaveBeenCalledTimes(1)
  })

  it('refuses to rebind an identity attached to another global person', async () => {
    const client = mockClient()
    const other: Person = { ...person, personUuid: 'other-person' as PersonUuid }
    client.findOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce(identity).mockResolvedValueOnce(other)
    await expect(ensureFormAuthor(client, profile, social)).rejects.toMatchObject({ status: 409 })
    expect(client.tx).not.toHaveBeenCalled()
  })

  it('confirms an existing local identity using the verified global identity', async () => {
    const client = mockClient()
    const pending: SocialIdentity = { ...identity, verifiedOn: undefined }
    client.findOne.mockResolvedValueOnce(person).mockResolvedValueOnce(pending).mockResolvedValueOnce(person)
    expect(await ensureFormAuthor(client, profile, social)).toBe(person._id)
    const apply = client.tx.mock.calls[0][0] as TxApplyIf
    expect(apply.txes).toHaveLength(1)
    expect(apply.txes[0]).toMatchObject({
      _class: core.class.TxUpdateDoc,
      objectClass: contact.class.SocialIdentity,
      objectId: social._id,
      operations: { verifiedOn: social.verifiedOn, isDeleted: false }
    })
  })

  it('stops after repeated conflicts without allowing the submission to proceed', async () => {
    const client = mockClient()
    client.tx.mockResolvedValue({ success: false, serverTime: 0 })
    await expect(ensureFormAuthor(client, profile, social)).rejects.toMatchObject({ status: 409 })
    expect(client.tx).toHaveBeenCalledTimes(3)
  })

  it.each([
    { ...social, verifiedOn: undefined },
    { ...social, isDeleted: true }
  ])('rejects unverified or deleted global identities', async (untrusted) => {
    const client = mockClient()
    await expect(ensureFormAuthor(client, profile, untrusted)).rejects.toMatchObject({ status: 401 })
    expect(client.findOne).not.toHaveBeenCalled()
    expect(client.tx).not.toHaveBeenCalled()
  })
})
