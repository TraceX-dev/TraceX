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

import { getClient as getAccountClient } from '@hcengineering/account-client'
import clientPlugin from '@hcengineering/client'
import contact, { setCurrentEmployee, setCurrentEmployeeSpace, type Employee } from '@hcengineering/contact'
import core, {
  AccountRole,
  ClientConnectEvent,
  pickPrimarySocialId,
  setCurrentAccount,
  versionToString,
  type Account,
  type Client,
  type PersonId,
  type Ref,
  type Version
} from '@hcengineering/core'
import login from '@hcengineering/login'
import { getMetadata, getResource, setMetadata } from '@hcengineering/platform'
import presentation, { refreshClient, setClient, setPresentationCookie } from '@hcengineering/presentation'
import { writable } from 'svelte/store'

export const embeddedVersionError = writable<string | undefined>(undefined)
export const embeddedConnectionError = writable(false)
let activeClient: Client | undefined
let activeToken: string | undefined

/** Connect a lightweight workspace without interactive login or account provisioning. */
export async function connectEmbeddedWorkspace (title: string, workspace: string, token: string): Promise<Client> {
  embeddedConnectionError.set(false)
  embeddedVersionError.set(undefined)
  const accountsUrl = getMetadata(login.metadata.AccountsUrl)
  const accounts = getAccountClient(accountsUrl, token)
  const info = await accounts.selectWorkspace(workspace)
  const selectedToken = info.token
  if (activeClient !== undefined && activeToken === selectedToken) return activeClient
  await disconnectEmbeddedWorkspace()

  setMetadata(presentation.metadata.Token, selectedToken)
  setMetadata(presentation.metadata.WorkspaceUuid, info.workspace)
  setMetadata(presentation.metadata.WorkspaceDataId, info.workspaceDataId)
  setMetadata(presentation.metadata.WorkspaceName, info.name ?? info.workspaceUrl)
  setMetadata(presentation.metadata.Endpoint, info.endpoint)
  setPresentationCookie(selectedToken, info.workspace)

  const socialIds =
    info.role === AccountRole.DocGuest ? [] : await getAccountClient(accountsUrl, selectedToken).getSocialIds(true)
  const account: Account = {
    uuid: info.account,
    role: info.role,
    primarySocialId: socialIds.length === 0 ? ('' as PersonId) : pickPrimarySocialId(socialIds)._id,
    socialIds: socialIds.map((id) => id._id),
    fullSocialIds: socialIds
  }
  setCurrentAccount(account)
  setCurrentEmployee('' as Ref<Employee>)

  const factory = await getResource(clientPlugin.function.GetClient)
  let connected = false
  const client = await factory(selectedToken, info.endpoint, {
    onHello: (version?: string) => {
      const expected = getMetadata(presentation.metadata.FrontVersion)
      if (
        expected !== undefined &&
        expected !== '' &&
        version !== undefined &&
        version !== '' &&
        expected !== version
      ) {
        embeddedVersionError.set('Client and server versions do not match')
        return false
      }
      return true
    },
    onUpgrade: () => { embeddedVersionError.set('Workspace upgrade interrupted the session'); },
    onError: () => { embeddedConnectionError.set(true); },
    onConnect: async (event: ClientConnectEvent, _lastTx: string | undefined, sessionId: unknown) => {
      if (event === ClientConnectEvent.Connected || event === ClientConnectEvent.Reconnected) {
        if (typeof sessionId === 'string') setMetadata(presentation.metadata.SessionId, sessionId)
        if (connected && event === ClientConnectEvent.Connected) await refreshClient(true)
        connected = true
      } else if (event === ClientConnectEvent.Refresh) {
        await refreshClient(true)
      } else if (event === ClientConnectEvent.Upgraded) {
        embeddedVersionError.set('Workspace upgrade interrupted the session')
      }
    }
  })
  activeClient = client
  activeToken = selectedToken

  try {
    const required = getMetadata(presentation.metadata.ModelVersion)
    const version = await client.findOne<Version>(core.class.Version, {})
    if (required !== undefined && required !== '' && (version === undefined || versionToString(version) !== required)) {
      embeddedVersionError.set('Workspace model version does not match')
      throw new Error('Workspace model version does not match')
    }
    if (account.role !== AccountRole.DocGuest) {
      const employee = await client.findOne(contact.mixin.Employee, { personUuid: info.account })
      if (employee !== undefined) {
        setCurrentEmployee(employee._id)
        const space = await client.findOne(contact.class.PersonSpace, { person: employee._id })
        if (space !== undefined) setCurrentEmployeeSpace(space._id)
      }
    }
    await setClient(client)
    document.title = [workspace, title].filter((value) => value !== '').join(' - ')
    return client
  } catch (error) {
    embeddedConnectionError.set(true)
    await disconnectEmbeddedWorkspace()
    throw error
  }
}

/** Dispose the connection owned by the lightweight workspace. */
export async function disconnectEmbeddedWorkspace (): Promise<void> {
  const client = activeClient
  activeClient = undefined
  activeToken = undefined
  if (client !== undefined) await client.close()
}
