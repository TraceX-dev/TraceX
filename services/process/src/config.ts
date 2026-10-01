//
// Copyright © 2025 Hardcore Engineering Inc.
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
import { config as dotenvConfig } from 'dotenv'

dotenvConfig()

export interface Config {
  Secret: string
  QueueConfig: string
  QueueRegion: string
  AccountsUrl: string
  TemporalAddress: string
  TemporalNamespace: string
  CollaboratorURL: string
  ClientIdleTimeoutMs: number
  ClientCacheMaxSize: number
  ClientConnectionTimeoutMs: number
}

function positiveInteger (name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

const config: Config = {
  Secret: process.env.SECRET ?? 'secret',
  QueueConfig: process.env.QUEUE_CONFIG ?? '',
  QueueRegion: process.env.QUEUE_REGION ?? '',
  AccountsUrl: process.env.ACCOUNTS_URL ?? '',
  TemporalAddress: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  TemporalNamespace: process.env.TEMPORAL_NAMESPACE ?? 'huly',
  CollaboratorURL: process.env.COLLABORATOR_URL ?? '',
  ClientIdleTimeoutMs: positiveInteger('PROCESS_CLIENT_IDLE_TIMEOUT_MS', 600000),
  ClientCacheMaxSize: positiveInteger('PROCESS_CLIENT_CACHE_MAX_SIZE', 32),
  ClientConnectionTimeoutMs: positiveInteger('PROCESS_CLIENT_CONNECTION_TIMEOUT_MS', 30000)
}

export default config
