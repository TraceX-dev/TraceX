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

import { getPlatformQueue } from '@hcengineering/kafka'
import type { PlatformQueue } from '@hcengineering/server-core'
import config from './config'
import { SERVICE_NAME } from './utils'

let platformQueue: PlatformQueue | undefined

/**
 * Shared platform queue for the whole service.
 * getPlatformQueue() creates a new Kafka client on every call, so it must not be
 * called per message: every instance opens its own broker connections, which are never closed.
 */
export function getQueue (): PlatformQueue {
  platformQueue ??= getPlatformQueue(SERVICE_NAME, config.QueueRegion)
  return platformQueue
}

export async function closeQueue (): Promise<void> {
  const queue = platformQueue
  platformQueue = undefined
  await queue?.shutdown()
}
