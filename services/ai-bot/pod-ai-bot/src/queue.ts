//
// Copyright © 2026 TraceX.
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
import { ConsumerControl, QueueTopic, QueueWorkspaceEvent, QueueWorkspaceMessage } from '@hcengineering/server-core'
import { AIEventRequest } from '@hcengineering/ai-bot'
import { MeasureContext } from '@hcengineering/core'
import { getPlatformQueue } from '@hcengineering/kafka'

import config from './config'
import { AIControl } from './controller'

const groupId = 'ai-bot'

const HEARTBEAT_INTERVAL = 5000

async function withHeartbeat<T> (queue: ConsumerControl, fn: () => Promise<T>): Promise<T> {
  const interval = setInterval(() => {
    void queue.heartbeat()
  }, HEARTBEAT_INTERVAL)
  try {
    return await fn()
  } finally {
    clearInterval(interval)
  }
}

export const startQueue = async (ctx: MeasureContext, aiControl: AIControl): Promise<() => void> => {
  const queue = getPlatformQueue(config.ServiceID, config.QueueRegion)

  const workspaceConsumer = queue.createConsumer<QueueWorkspaceMessage>(
    ctx,
    QueueTopic.Workspace,
    groupId,
    async (ctx, message) => {
      try {
        if (message.value.type === QueueWorkspaceEvent.Up) {
          ctx.info('Received Workspace event from queue', { workspace: message.workspace })
          await aiControl.connect(message.workspace)
        }
      } catch (err: any) {
        ctx.error('failed to handle workspace event', { error: err.message })
      }
    }
  )

  const aiEventConsumer = queue.createConsumer<AIEventRequest>(
    ctx,
    QueueTopic.AI,
    groupId,
    async (ctx, message, control) => {
      try {
        ctx.info('Received AI event from queue', { workspace: message.workspace })
        await withHeartbeat(control, () => aiControl.processEvent(message.workspace, [message.value]))
      } catch (err: any) {
        ctx.error('failed to handle ai event', { error: err.message })
      }
    }
  )

  const close = (): void => {
    void workspaceConsumer?.close()
    void aiEventConsumer?.close()
    void queue.shutdown()
  }

  return close
}
