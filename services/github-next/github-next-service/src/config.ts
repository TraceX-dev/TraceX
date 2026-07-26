//
// Copyright © 2026 Hardcore Engineering Inc.
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

interface Config {
  ServiceID: string
  AccountsURL: string
  FrontURL: string
  CollaboratorURL: string
  HulylakeURL: string
  Port: number
  ClientID: string
  ClientSecret: string
  PublicURL: string
  PollIntervalMs: number
  OutboundDebounceMs: number
  QueueRegion: string
  SyncInbound: boolean
  SyncOutbound: boolean
}

const envMap: { [key in keyof Config]: string } = {
  ServiceID: 'SERVICE_ID',
  AccountsURL: 'ACCOUNTS_URL',
  FrontURL: 'FRONT_URL',
  CollaboratorURL: 'COLLABORATOR_URL',
  HulylakeURL: 'HULYLAKE_URL',
  Port: 'PORT',
  ClientID: 'CLIENT_ID',
  ClientSecret: 'CLIENT_SECRET',
  PublicURL: 'PUBLIC_URL',
  PollIntervalMs: 'POLL_INTERVAL_MS',
  OutboundDebounceMs: 'OUTBOUND_DEBOUNCE_MS',
  QueueRegion: 'QUEUE_REGION',
  SyncInbound: 'SYNC_INBOUND',
  SyncOutbound: 'SYNC_OUTBOUND'
}

const required: Array<keyof Config> = ['AccountsURL', 'FrontURL', 'CollaboratorURL', 'ClientID', 'ClientSecret']

function parseNumber (value: string | undefined, fallback: number): number {
  return value !== undefined ? Number(value) : fallback
}

function parseBoolean (value: string | undefined, fallback: boolean): boolean {
  return value !== undefined ? value === 'true' : fallback
}

const config: Config = (() => {
  const port = parseNumber(process.env[envMap.Port], 3510)
  const params: Partial<Config> = {
    ServiceID: process.env[envMap.ServiceID] ?? 'github-next-service',
    AccountsURL: process.env[envMap.AccountsURL],
    FrontURL: process.env[envMap.FrontURL],
    CollaboratorURL: process.env[envMap.CollaboratorURL],
    HulylakeURL: process.env[envMap.HulylakeURL] ?? 'http://huly.local:8096',
    Port: port,
    ClientID: process.env[envMap.ClientID],
    ClientSecret: process.env[envMap.ClientSecret],
    PublicURL: process.env[envMap.PublicURL] ?? `http://huly.local:${port}`,
    PollIntervalMs: parseNumber(process.env[envMap.PollIntervalMs], 300000),
    OutboundDebounceMs: parseNumber(process.env[envMap.OutboundDebounceMs], 1000),
    QueueRegion: process.env[envMap.QueueRegion] ?? '',
    SyncInbound: parseBoolean(process.env[envMap.SyncInbound], true),
    SyncOutbound: parseBoolean(process.env[envMap.SyncOutbound], true)
  }

  const missingEnv = required.filter((key) => params[key] === undefined || params[key] === '').map((key) => envMap[key])

  if (missingEnv.length > 0) {
    throw Error(`Missing env variables: ${missingEnv.join(', ')}`)
  }

  return params as Config
})()

export default config
