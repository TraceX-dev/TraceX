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
import { QueueTopic, QueueWorkspaceEvent, QueueWorkspaceMessage } from '@hcengineering/server-core'
import { AIEventRequest } from '@hcengineering/ai-bot'
import { MeasureContext } from '@hcengineering/core'
import { getPlatformQueue } from '@hcengineering/kafka'

import config from './config'
import { AIControl } from './controller'

export const startQueue = async (
  ctx: MeasureContext,
  aiControl: AIControl
): Promise<() => void> => {
  const queue = getPlatformQueue(config.ServiceID, config.QueueRegion)

  const workspaceConsumer = queue.createConsumer<QueueWorkspaceMessage>(
    ctx,
    QueueTopic.Workspace,
    'ai-bot',
    async (ctx, message, control) => {
      try {
        if (message.value.type === QueueWorkspaceEvent.Up) {
          await aiControl.connect(message.workspace)
        }
      } catch (err: any) {
        ctx.error('failed to handle operation', { error: err.message })
      }
    }
  )

  const aiEventConsumer = queue.createConsumer<AIEventRequest>(
    ctx,
    QueueTopic.AIQueue,
    'ai-bot',
    async (ctx, message) => {
      try {
        ctx.info('Received AI event from queue', { workspace: message.workspace })
        await aiControl.processEvent(message.workspace, [message.value])
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
