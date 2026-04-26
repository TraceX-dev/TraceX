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

import contact from '@hcengineering/contact'
import {
  AccountUuid,
  Class,
  Doc,
  MeasureContext,
  PersonUuid,
  Ref,
  TxOperations,
  type WorkspaceIds
} from '@hcengineering/core'
import { StorageAdapter } from '@hcengineering/server-core'
import { HistoryRecord } from '../types'
import { type MemoryStorage, type PersonHistoryRecord } from './types'

export class BlobMemoryStorage implements MemoryStorage {
  private readonly historyMap = new Map<PersonUuid, PersonHistoryRecord>()

  constructor (
    private readonly storage: StorageAdapter,
    private readonly ctx: MeasureContext,
    private readonly wsIds: WorkspaceIds,
    private readonly getClient: () => Promise<TxOperations>
  ) {}

  async getHistory (personUuid: PersonUuid): Promise<PersonHistoryRecord> {
    if (this.historyMap.has(personUuid)) {
      return (
        this.historyMap.get(personUuid) ?? {
          assistantMemory: '',
          userMemory: '',
          sharedContext: '',
          history: []
        }
      )
    }

    try {
      const personHistory: PersonHistoryRecord = JSON.parse(
        Buffer.concat(await this.storage.read(this.ctx, this.wsIds, 'ai-bot-phr-' + personUuid)).toString()
      )

      if (personHistory.sharedContext === undefined) {
        personHistory.sharedContext = ''
      }

      this.historyMap.set(personUuid, personHistory)
      return personHistory
    } catch (err: any) {
      // Ignore, no history available
    }

    const client = await this.getClient()
    const personData = await client?.findOne(contact.mixin.Employee, { personUuid: personUuid as AccountUuid })

    const v: PersonHistoryRecord = {
      assistantMemory: '',
      userMemory: personData !== undefined ? `User name: ${personData.name}` : '',
      sharedContext: '',
      history: []
    }
    this.historyMap.set(personUuid, v)
    return v
  }

  async saveHistory (personUuid: PersonUuid, history: PersonHistoryRecord): Promise<void> {
    await this.storage.put(
      this.ctx,
      this.wsIds,
      'ai-bot-phr-' + personUuid,
      JSON.stringify(history),
      'application/json'
    )
  }

  async updateAssistantMemory (user: PersonUuid | undefined, args: Record<string, any>): Promise<void> {
    if (user === undefined) return

    const currentHistory = await this.getHistory(user)
    currentHistory.assistantMemory = args.memory ?? currentHistory.assistantMemory

    await this.saveHistory(user, currentHistory)
  }

  async updateUserMemory (user: PersonUuid | undefined, args: Record<string, any>): Promise<void> {
    if (user === undefined) return

    const currentHistory = await this.getHistory(user)
    currentHistory.userMemory = args.memory ?? currentHistory.userMemory

    await this.saveHistory(user, currentHistory)
  }

  async updateSharedContext (user: PersonUuid | undefined, args: Record<string, any>): Promise<void> {
    if (user === undefined) return

    const currentHistory = await this.getHistory(user)
    currentHistory.sharedContext = args.context ?? currentHistory.sharedContext

    await this.saveHistory(user, currentHistory)
  }

  async clearHistory (user: PersonUuid | undefined): Promise<void> {
    if (user === undefined) return

    const currentHistory = await this.getHistory(user)
    currentHistory.history = []

    await this.saveHistory(user, currentHistory)
  }

  async pushHistory (
    personUuid: PersonUuid,
    message: string,
    role: 'user' | 'assistant',
    tokens: number,
    user: PersonUuid,
    objectId: Ref<Doc>,
    objectClass: Ref<Class<Doc>>
  ): Promise<void> {
    const currentHistory = await this.getHistory(personUuid)
    const newRecord: HistoryRecord = {
      workspace: this.wsIds.uuid,
      message,
      objectId,
      objectClass,
      role,
      user,
      tokens,
      timestamp: Date.now()
    }
    currentHistory.history.push({ ...newRecord })
    this.historyMap.set(personUuid, currentHistory)
  }
}
