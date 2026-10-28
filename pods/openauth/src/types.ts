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

export interface OAuthConfig {
  issuerUrl: string
  resourceUrl: string
  loginUrl: string
  serverSecret: string
}

export interface RegisteredClient {
  id: string
  name: string
  redirectUris: string[]
}

export interface AuthorizationState {
  client_id: string
  redirect_uri: string
  response_type: string
  state?: string
  audience?: string
  pkce?: { challenge: string, method: string }
}

export interface PendingLogin {
  clientId: string
  authorization: string
  account?: string
  accountToken?: string
}

export interface OAuthConnection {
  id: string
  account: string
  clientId: string
  clientName: string
  resource: string
  accountToken: string
  createdOn: number
  revokedOn?: number
}

export interface PublicConnection {
  id: string
  clientName: string
  createdOn: number
}

export interface TraceXIdentity {
  account: string
  token: string
}
