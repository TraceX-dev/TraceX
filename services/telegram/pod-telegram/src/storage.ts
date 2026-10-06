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

import { randomUUID } from 'crypto'
import postgres from 'postgres'
import config from './config'
import type { LastMsgRecord, UserRecord, WorkspaceChannel } from './types'

interface StoredRecord {
  _id?: string
}

/** Stores Telegram integration records in PostgreSQL. */
export class RecordStorage<T extends StoredRecord> {
  constructor (private readonly client: postgres.Sql, private readonly table: string) {}

  async find (query: Partial<T> = {}): Promise<T[]> {
    const rows = await this.client<{ data: T }[]>`
      SELECT data FROM ${this.client(this.table)} WHERE data @> ${JSON.stringify(query)}::jsonb
    `
    return rows.map((row) => row.data)
  }

  async findOne (query: Partial<T>): Promise<T | null> {
    const rows = await this.client<{ data: T }[]>`
      SELECT data FROM ${this.client(this.table)} WHERE data @> ${JSON.stringify(query)}::jsonb LIMIT 1
    `
    return rows[0]?.data ?? null
  }

  async insertOne (record: T): Promise<string> {
    const id = record._id ?? randomUUID()
    await this.client`
      INSERT INTO ${this.client(this.table)} (id, data) VALUES (${id}, ${JSON.stringify({ ...record, _id: id })}::jsonb)
    `
    return id
  }

  async updateOne (query: Partial<T>, values: Partial<T>): Promise<void> {
    await this.client`
      UPDATE ${this.client(this.table)} SET data = data || ${JSON.stringify(values)}::jsonb
      WHERE id = (SELECT id FROM ${this.client(this.table)} WHERE data @> ${JSON.stringify(query)}::jsonb LIMIT 1)
    `
  }

  async deleteOne (query: Partial<T>): Promise<void> {
    await this.client`
      DELETE FROM ${this.client(this.table)}
      WHERE id = (SELECT id FROM ${this.client(this.table)} WHERE data @> ${JSON.stringify(query)}::jsonb LIMIT 1)
    `
  }

  async deleteMany (query: Partial<T>): Promise<void> {
    await this.client`DELETE FROM ${this.client(this.table)} WHERE data @> ${JSON.stringify(query)}::jsonb`
  }
}

export interface TelegramStorage {
  users: RecordStorage<UserRecord>
  messages: RecordStorage<LastMsgRecord>
  channels: RecordStorage<WorkspaceChannel>
}

let client: postgres.Sql | undefined
let storage: Promise<TelegramStorage> | undefined

export async function getDB (): Promise<TelegramStorage> {
  if (storage === undefined) {
    const sql = postgres(config.DbUrl, { connection: { application_name: config.ServiceID } })
    client = sql
    storage = (async () => {
      try {
        await sql`CREATE SCHEMA IF NOT EXISTS telegram_service`
        for (const table of ['integrations', 'last_messages', 'channels']) {
          await sql`CREATE TABLE IF NOT EXISTS ${sql('telegram_service.' + table)} (id UUID PRIMARY KEY, data JSONB NOT NULL)`
        }
        await sql`CREATE UNIQUE INDEX IF NOT EXISTS integrations_phone_workspace ON telegram_service.integrations ((data->>'phone'), (data->>'workspace'))`
        await sql`CREATE UNIQUE INDEX IF NOT EXISTS integrations_email_workspace ON telegram_service.integrations ((data->>'email'), (data->>'workspace'))`
        await sql`CREATE UNIQUE INDEX IF NOT EXISTS last_messages_identity ON telegram_service.last_messages ((data->>'phone'), (data->>'participantID'), (data->>'channelID'), (data->>'workspace'))`
        return {
          users: new RecordStorage<UserRecord>(sql, 'telegram_service.integrations'),
          messages: new RecordStorage<LastMsgRecord>(sql, 'telegram_service.last_messages'),
          channels: new RecordStorage<WorkspaceChannel>(sql, 'telegram_service.channels')
        }
      } catch (error) {
        storage = undefined
        client = undefined
        await sql.end()
        throw error
      }
    })()
  }
  return await storage
}

export async function closeDB (): Promise<void> {
  try {
    await storage
  } finally {
    await client?.end()
    client = undefined
    storage = undefined
  }
}
