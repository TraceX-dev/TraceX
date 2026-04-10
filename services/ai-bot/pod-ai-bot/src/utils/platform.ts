//
// Copyright © 2024 Hardcore Engineering Inc.
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
import core, { AccountUuid, Client, Ref, TxOperations, WorkspaceUuid } from '@hcengineering/core'
import contact, { Employee, Person } from '@hcengineering/contact'
import chunter, { DirectMessage } from '@hcengineering/chunter'
import { aiBotEmailSocialKey } from '@hcengineering/ai-bot'
import { createRestClient, RestClientAdapter } from '@hcengineering/api-client'

export async function connectPlatform (token: string, workspaceId: WorkspaceUuid, endpoint: string): Promise<Client> {
  const client = createRestClient(toHttpUrl(endpoint), workspaceId, token)
  const { model, hierarchy } = await client.getModel()
  return new RestClientAdapter(client, hierarchy, model)
}

export async function getAccountBySocialKey (client: TxOperations, socialKey: string): Promise<AccountUuid | null> {
  const socialIdentity = await client.findOne(contact.class.SocialIdentity, { key: socialKey })

  if (socialIdentity == null) {
    return null
  }

  const employee = await client.findOne(contact.mixin.Employee, { _id: socialIdentity.attachedTo as Ref<Employee> })

  return employee?.personUuid ?? null
}

export async function getDirect (
  client: TxOperations,
  account: AccountUuid,
  aiPerson?: Ref<Person>
): Promise<Ref<DirectMessage> | undefined> {
  const aibotAccount = await getAccountBySocialKey(client, aiBotEmailSocialKey)
  if (aibotAccount == null) return undefined

  const existingDm = (await client.findAll(chunter.class.DirectMessage, { members: aibotAccount })).find((dm) =>
    dm.members.every((m) => m === aibotAccount || m === account)
  )

  if (existingDm !== undefined) {
    return existingDm._id
  }

  return await client.createDoc<DirectMessage>(chunter.class.DirectMessage, core.space.Space, {
    name: '',
    description: '',
    private: true,
    archived: false,
    members: [aibotAccount, account]
  })
}

function toHttpUrl (url: string): string {
  return url.replace('ws://', 'http://').replace('wss://', 'https://')
}
