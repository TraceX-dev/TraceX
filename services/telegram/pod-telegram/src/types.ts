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
import { Api } from 'telegram'
import { TelegramConnectionInterface } from './telegram'
import { TelegramMessage as OldTelegramMessage } from '@hcengineering/telegram'
import { Timestamp } from '@hcengineering/core'

export interface Doc {
  _id?: string
}

export interface UserRecord extends Doc {
  phone: string
  workspace: string
  userId: string
  email: string
  token: string
}

export interface LastMsgRecord extends Doc {
  workspace: string
  phone: string
  participantID: string
  channelID: string
  maxMsgId: number
  minMsgId: number
}

export interface User {
  email: string
  workspace: string
}

export interface TgUser extends User {
  phone: string
  conn: TelegramConnectionInterface
}

export interface Contact {
  firstName: string
  lastName: string
  phone: string
}

export interface Event {
  user: Api.User
  msg: Api.Message
}

export interface WorkspaceChannel extends Doc {
  workspace: string
  value: string
}

export interface AttachedFile {
  size?: number
  file: Buffer
  type: string
  lastModified: number
  name: string
}

export interface TelegramMessage extends OldTelegramMessage {
  sendOn: Timestamp
}
