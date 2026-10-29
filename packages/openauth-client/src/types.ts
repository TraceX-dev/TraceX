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
}

/** Public issuer API used by consent and connection-management screens. */
export interface OpenAuthClient {
  getRequest: (request: string) => Promise<OAuthRequestDetails>
  completeRequest: (request: string, token: string) => Promise<void>
  getConnections: (token: string | undefined) => Promise<PublicConnection[]>
  revokeConnection: (id: string, token: string | undefined) => Promise<void>
  getCompletionUrl: (request: string) => string
  getCancelUrl: (request: string) => string
}
