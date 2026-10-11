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
  type Doc,
  type DocumentClassQuery,
  type Person as GlobalPerson,
  type Ref,
  type SocialId,
  type TxApplyResult,
  type TxCUD,
  TxFactory,
  buildSocialIdString
} from '@hcengineering/core'
import { FormError } from './forms-validation'

/** Resolves a verified form author locally without creating an employee or granting workspace access. */
export async function ensureFormAuthor (
  client: Pick<Client, 'findOne' | 'tx'>,
  profile: GlobalPerson,
  social: SocialId
): Promise<Ref<Person>> {
  if (social.verifiedOn === undefined || social.isDeleted === true) throw new FormError(401, 'unauthorized')
  const socialRef = social._id as SocialIdentity['_id']
  const factory = new TxFactory(core.account.System)

  for (let attempt = 0; attempt < 3; attempt++) {
    const [byUuid, identity] = await Promise.all([
      client.findOne(contact.class.Person, { personUuid: profile.uuid }),
      client.findOne(contact.class.SocialIdentity, { _id: socialRef })
    ])
    const attached =
      identity === undefined ? undefined : await client.findOne(contact.class.Person, { _id: identity.attachedTo })
    if (
      identity !== undefined &&
      (identity.type !== social.type ||
        identity.value !== social.value ||
        attached === undefined ||
        (attached.personUuid !== undefined && attached.personUuid !== profile.uuid) ||
        (byUuid !== undefined && byUuid._id !== attached._id))
    ) {
      throw new FormError(409, 'unavailable')
    }
    const person = byUuid ?? attached
    const match: DocumentClassQuery<Doc>[] = []
    const notMatch: DocumentClassQuery<Doc>[] = []
    const txes: TxCUD<Doc>[] = []
    let personRef: Ref<Person>
    if (person === undefined) {
      const create = factory.createTxCreateDoc(contact.class.Person, contact.space.Contacts, {
        personUuid: profile.uuid,
        name: combineName(profile.firstName, profile.lastName),
        avatarType: AvatarType.COLOR,
        city: ''
      })
      personRef = create.objectId
      notMatch.push({ _class: contact.class.Person, query: { personUuid: profile.uuid } })
      txes.push(create)
    } else {
      personRef = person._id
      match.push({
        _class: contact.class.Person,
        query: { _id: personRef, personUuid: person.personUuid ?? { $exists: false } }
      })
      if (person.personUuid === undefined) {
        notMatch.push({ _class: contact.class.Person, query: { personUuid: profile.uuid } })
        txes.push(
          factory.createTxUpdateDoc(contact.class.Person, person.space, personRef, { personUuid: profile.uuid })
        )
      }
    }
    if (identity === undefined) {
      notMatch.push({ _class: contact.class.SocialIdentity, query: { _id: socialRef } })
      txes.push(
        factory.createTxCollectionCUD(
          contact.class.Person,
          personRef,
          person?.space ?? contact.space.Contacts,
          'socialIds',
          factory.createTxCreateDoc(
            contact.class.SocialIdentity,
            person?.space ?? contact.space.Contacts,
            {
              attachedTo: personRef,
              attachedToClass: contact.class.Person,
              collection: 'socialIds',
              type: social.type,
              value: social.value,
              key: buildSocialIdString(social),
              verifiedOn: social.verifiedOn,
              isDeleted: false
            },
            socialRef
          )
        )
      )
    } else {
      match.push({
        _class: contact.class.SocialIdentity,
        query: { _id: socialRef, attachedTo: personRef, type: social.type, value: social.value }
      })
      if (identity.verifiedOn === undefined || identity.isDeleted === true) {
        txes.push(
          factory.createTxUpdateDoc(contact.class.SocialIdentity, identity.space, socialRef, {
            verifiedOn: social.verifiedOn,
            isDeleted: false
          })
        )
      }
    }
    if (txes.length === 0) return personRef
    const result = (await client.tx(
      factory.createTxApplyIf(
        core.space.Workspace,
        `forms-author:${profile.uuid}`,
        match,
        notMatch,
        txes,
        'ensureFormAuthor'
      )
    )) as TxApplyResult
    if (result.success) return personRef
    // A concurrent submission may have created the contact; resolve its actual reference again.
  }
  throw new FormError(409, 'unavailable')
}
