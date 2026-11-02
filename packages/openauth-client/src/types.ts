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

export interface OAuthRequestDetails {
  clientName: string
  redirectOrigins: string[]
}

export interface PublicConnection {
  id: string
  clientName: string
  createdOn: number
  workspaceId: string | null
  workspaceName?: string
  workspaceUrl?: string
}

export interface OAuthWorkspace {
  id: string
  name: string
  url: string
}

export interface ResolvedAccessToken {
  connectionId: string
  account: string
  accountToken: string
  clientId: string
  resource: string
  expiresAt: number
  workspaceId: string | null
}

/** Issuer API for consent, connections, and authenticated server-to-server token resolution. */
export interface OpenAuthClient {
  getRequest: (request: string) => Promise<OAuthRequestDetails>
  completeRequest: (request: string, token: string, workspaceId: string | null) => Promise<void>
  getWorkspaces: (request: string, token: string) => Promise<OAuthWorkspace[]>
  getConnections: (token: string | undefined) => Promise<PublicConnection[]>
  revokeConnection: (id: string, token: string | undefined) => Promise<void>
  getCompletionUrl: (request: string) => string
  getCancelUrl: (request: string) => string
  resolveAccessToken: (token: string, resource: string, serviceToken: string) => Promise<ResolvedAccessToken>
}
