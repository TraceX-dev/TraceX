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

import { Class, Doc, PersonUuid, Ref } from '@hcengineering/core'
import { HistoryRecord } from '../types'

export interface PersonHistoryRecord {
  assistantMemory: string
  userMemory: string
  sharedContext: string
  history: HistoryRecord[]
}

export interface MemoryStorage {
  getHistory: (personUuid: PersonUuid) => Promise<PersonHistoryRecord>
  saveHistory: (personUuid: PersonUuid, history: PersonHistoryRecord) => Promise<void>
  updateAssistantMemory: (user: PersonUuid | undefined, args: Record<string, any>) => Promise<void>
  updateUserMemory: (user: PersonUuid | undefined, args: Record<string, any>) => Promise<void>
  updateSharedContext: (user: PersonUuid | undefined, args: Record<string, any>) => Promise<void>
  clearHistory: (user: PersonUuid | undefined) => Promise<void>
  pushHistory: (
    personUuid: PersonUuid,
    message: string,
    role: 'user' | 'assistant',
    tokens: number,
    user: PersonUuid,
    objectId: Ref<Doc>,
    objectClass: Ref<Class<Doc>>
  ) => Promise<void>
}
