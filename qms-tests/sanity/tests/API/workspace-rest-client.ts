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

import {
  type Account,
  type Class,
  type Doc,
  type DocumentQuery,
  type Ref,
  type Tx,
  TxFactory
} from '@hcengineering/core'
import { type APIRequestContext } from '@playwright/test'

import { PlatformPassword, PlatformURI, PlatformWs } from '../utils'

/** The account service. `uitest` passes it as `LOCAL_URL`, `dev-uitest` as `DEV_URL`. */
function getAccountsUrl (): string {
  const dev = process.env.DEV_URL
  const url = dev !== undefined && dev.trim() !== '' ? dev : process.env.LOCAL_URL
  if (url === undefined || url.trim() === '') {
    throw new Error('LOCAL_URL or DEV_URL must point to the account service')
  }
  return url
}

function headers (token?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: PlatformURI,
    Referer: PlatformURI,
    ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {})
  }
}

async function accountsCall<T> (
  request: APIRequestContext,
  method: string,
  params: Record<string, unknown>,
  token?: string
): Promise<T> {
  const response = await request.post(getAccountsUrl(), { data: { method, params }, headers: headers(token) })
  const body = await response.json()
  if (!response.ok() || body.result === undefined) {
    throw new Error(`Account service ${method} failed: ${response.status()} ${JSON.stringify(body.error ?? body)}`)
  }
  return body.result as T
}

/**
 * Talks to the transactor REST API on behalf of one account, bypassing the UI.
 * Used to prepare test data that takes many UI steps to create, and to check what was saved.
 */
export class WorkspaceRestClient {
  private constructor (
    private readonly request: APIRequestContext,
    private readonly endpoint: string,
    private readonly workspace: string,
    private readonly token: string,
    readonly account: Account,
    readonly factory: TxFactory
  ) {}

  static async connect (
    request: APIRequestContext,
    email: string,
    password: string = PlatformPassword,
    workspaceUrl: string = PlatformWs
  ): Promise<WorkspaceRestClient> {
    const login = await accountsCall<{ token: string }>(request, 'login', { email, password })
    const info = await accountsCall<{ token: string, endpoint: string, workspace: string }>(
      request,
      'selectWorkspace',
      { workspaceUrl },
      login.token
    )
    // Same conversion as the platform REST client: ws://host -> http://host, wss://host -> https://host.
    const endpoint = info.endpoint.replace(/^ws/, 'http').replace(/\/$/, '')
    const response = await request.get(`${endpoint}/api/v1/account/${info.workspace}`, {
      headers: headers(info.token)
    })
    if (!response.ok()) {
      throw new Error(`Failed to get account of ${email}: ${response.status()} ${await response.text()}`)
    }
    const account: Account = await response.json()
    return new WorkspaceRestClient(
      request,
      endpoint,
      info.workspace,
      info.token,
      account,
      new TxFactory(account.primarySocialId)
    )
  }

  async findAll<T extends Doc>(_class: Ref<Class<T>>, query: DocumentQuery<T>): Promise<T[]> {
    const response = await this.request.post(`${this.endpoint}/api/v1/find-all/${this.workspace}`, {
      headers: headers(this.token),
      data: { _class, query, options: {} }
    })
    if (!response.ok()) {
      throw new Error(`findAll ${_class} failed: ${response.status()} ${await response.text()}`)
    }
    const body = await response.json()
    // Results with a total are sent as { dataType: 'TotalArray', value: [...] }.
    return Array.isArray(body) ? body : (body.value ?? [])
  }

  async findOne<T extends Doc>(_class: Ref<Class<T>>, query: DocumentQuery<T>): Promise<T | undefined> {
    return (await this.findAll(_class, query))[0]
  }

  /** Sends a tx and throws if the server rejects it. */
  async tx (tx: Tx): Promise<void> {
    const response = await this.request.post(`${this.endpoint}/api/v1/tx/${this.workspace}`, {
      headers: headers(this.token),
      data: tx
    })
    if (!response.ok()) {
      throw new Error(`tx ${tx._class} failed: ${response.status()} ${await response.text()}`)
    }
  }
}
