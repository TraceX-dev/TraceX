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

import type { OAuthRequestDetails, OpenAuthClient, PublicConnection } from './types'

/** Creates a client for the trusted issuer URL, including its optional path prefix. */
export function getClient (issuerUrl: string): OpenAuthClient {
  if (issuerUrl.trim() === '') throw new Error('OAuth issuer URL is required')
  return new HttpOpenAuthClient(issuerUrl.replace(/\/+$/, ''))
}

class HttpOpenAuthClient implements OpenAuthClient {
  constructor (private readonly endpoint: string) {}

  async getRequest (request: string): Promise<OAuthRequestDetails> {
    const response = await this.fetch(`/requests/${requestId(request)}`)
    return (await response.json()) as OAuthRequestDetails
  }

  async completeRequest (request: string, token: string): Promise<void> {
    await this.fetch(`/requests/${requestId(request)}/complete`, {
      method: 'POST',
      headers: authorization(token)
    })
  }

  async getConnections (token: string | undefined): Promise<PublicConnection[]> {
    const response = await this.fetch('/connections', { headers: authorization(token) })
    return (await response.json()) as PublicConnection[]
  }

  async revokeConnection (id: string, token: string | undefined): Promise<void> {
    await this.fetch(`/connections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authorization(token)
    })
  }

  getCompletionUrl (request: string): string {
    return `${this.endpoint}/tracex/complete?request=${requestId(request)}`
  }

  getCancelUrl (request: string): string {
    return `${this.endpoint}/tracex/cancel?request=${requestId(request)}`
  }

  private async fetch (path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${this.endpoint}${path}`, init)
    if (!response.ok) throw new Error(`OpenAuth request failed (${response.status})`)
    return response
  }
}

function requestId (request: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(request)) throw new Error('Invalid OAuth request')
  return encodeURIComponent(request)
}

function authorization (token: string | undefined): Record<string, string> {
  if (token === undefined || token === '') throw new Error('An authenticated TraceX session is required')
  return { Authorization: `Bearer ${token}` }
}
