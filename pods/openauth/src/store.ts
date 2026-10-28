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

import { AsyncLocalStorage } from 'node:async_hooks'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { getMigrations } from './migrations'
import { hash } from './protocol'
import type { OAuthConnection, PublicConnection, RegisteredClient } from './types'

/** Persistent issuer storage. Secrets are encrypted and bearer tokens never appear in database keys. */
export class OAuthStore {
  private readonly database: Sql
  private readonly transaction = new AsyncLocalStorage<Sql>()
  private readonly encryptionKey: Buffer

  constructor (databaseUrl: string, secret: string) {
    this.database = postgres(databaseUrl, { max: 10 })
    this.encryptionKey = createHash('sha256').update('TraceX OAuth storage v1\0').update(secret).digest()
  }

  private get sql (): Sql {
    return this.transaction.getStore() ?? this.database
  }

  async init (): Promise<void> {
    // Keep this lock key stable across schema versions and rolling deployments.
    await this.withLock('openauth:schema:v1', async () => {
      await this.initializeSchema()
    })
  }

  private async initializeSchema (): Promise<void> {
    await this.sql`CREATE SCHEMA IF NOT EXISTS openauth`
    await this.sql`CREATE TABLE IF NOT EXISTS openauth.migrations (
      name TEXT PRIMARY KEY, created_on TIMESTAMP NOT NULL DEFAULT now()
    )`
    const applied = new Set(
      (await this.sql<{ name: string }[]>`SELECT name FROM openauth.migrations`).map((row) => row.name)
    )
    for (const [name, query] of getMigrations()) {
      if (applied.has(name)) continue
      try {
        await this.sql.unsafe(query)
        await this.sql`INSERT INTO openauth.migrations (name) VALUES (${name})`
      } catch (error: unknown) {
        throw new Error(`Failed to apply OAuth schema migration: ${name}`, { cause: error })
      }
    }
  }

  private encrypt (value: unknown): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
  }

  private decrypt<T>(value: string): T {
    const data = Buffer.from(value, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, data.subarray(0, 12))
    decipher.setAuthTag(data.subarray(12, 28))
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')) as T
  }

  async get (key: string[]): Promise<Record<string, unknown> | undefined> {
    const rows = await this.sql<{ value: string }[]>`
      SELECT value FROM openauth.storage WHERE key = ${hash(JSON.stringify(key))}
      AND (expires_on IS NULL OR expires_on > ${Date.now()})`
    return rows[0] === undefined ? undefined : this.decrypt<{ value: Record<string, unknown> }>(rows[0].value).value
  }

  async set (key: string[], value: unknown, expiry?: Date): Promise<void> {
    const prefixes = key.map((_, index) => hash(JSON.stringify(key.slice(0, index + 1))))
    const encrypted = this.encrypt({ key, value })
    await this.sql`INSERT INTO openauth.storage (key, prefixes, value, expires_on)
      VALUES (${hash(JSON.stringify(key))}, ${this.sql.array(prefixes)}, ${encrypted}, ${expiry?.getTime() ?? null})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_on = EXCLUDED.expires_on`
  }

  async remove (key: string[]): Promise<void> {
    await this.sql`DELETE FROM openauth.storage WHERE key = ${hash(JSON.stringify(key))}`
  }

  async *scan (prefix: string[]): AsyncIterable<[string[], Record<string, unknown>]> {
    const rows = await this.sql<{ value: string }[]>`SELECT value FROM openauth.storage
      WHERE ${hash(JSON.stringify(prefix))} = ANY(prefixes) AND (expires_on IS NULL OR expires_on > ${Date.now()})`
    for (const row of rows) {
      const entry = this.decrypt<{ key: string[], value: Record<string, unknown> }>(row.value)
      yield [entry.key, entry.value]
    }
  }

  /** Serializes authorization-code consumption and refresh rotation across issuer replicas. */
  async withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    return (await this.database.begin(async (transaction) => {
      // TransactionSql exposes the same query interface, without pool-management methods.
      const sql = transaction as unknown as Sql
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      return await this.transaction.run(sql, action)
    })) as T
  }

  async registerClient (client: RegisteredClient): Promise<void> {
    await this.sql`INSERT INTO openauth.client (id, data) VALUES (${client.id}, ${this.sql.json({ ...client })})`
  }

  async getClient (id: string): Promise<RegisteredClient | undefined> {
    const rows = await this.sql<{ data: RegisteredClient }[]>`SELECT data FROM openauth.client WHERE id = ${id}`
    return rows[0]?.data
  }

  async createConnection (connection: OAuthConnection): Promise<void> {
    await this.sql`INSERT INTO openauth.connection
      (id, account, client_id, client_name, resource, account_token, created_on)
      VALUES (${connection.id}, ${connection.account}, ${connection.clientId}, ${connection.clientName},
      ${connection.resource}, ${this.encrypt(connection.accountToken)}, ${connection.createdOn})`
  }

  async getConnection (id: string): Promise<OAuthConnection | undefined> {
    const rows = await this.sql<
      {
        id: string
        account: string
        client_id: string
        client_name: string
        resource: string
        account_token: string
        created_on: string
        revoked_on: string | null
      }[]
    >`SELECT * FROM openauth.connection WHERE id = ${id} AND revoked_on IS NULL`
    const row = rows[0]
    return row === undefined
      ? undefined
      : {
          id: row.id,
          account: row.account,
          clientId: row.client_id,
          clientName: row.client_name,
          resource: row.resource,
          accountToken: this.decrypt<string>(row.account_token),
          createdOn: Number(row.created_on)
        }
  }

  async listConnections (account: string, resource: string): Promise<PublicConnection[]> {
    const rows = await this.sql<{ id: string, client_name: string, created_on: string }[]>`
      SELECT id, client_name, created_on FROM openauth.connection
      WHERE account = ${account} AND resource = ${resource} AND revoked_on IS NULL ORDER BY created_on DESC`
    return rows.map((row) => ({ id: row.id, clientName: row.client_name, createdOn: Number(row.created_on) }))
  }

  async revokeConnection (id: string, account: string, resource: string): Promise<void> {
    await this.sql`UPDATE openauth.connection SET revoked_on = ${Date.now()}, account_token = ''
      WHERE id = ${id} AND account = ${account} AND resource = ${resource} AND revoked_on IS NULL`
    // An already-issued access token is also checked against the connection on every request.
    await this.sql`DELETE FROM openauth.access_token WHERE connection_id = ${id}
      AND EXISTS (SELECT 1 FROM openauth.connection WHERE id = ${id} AND account = ${account}
      AND resource = ${resource} AND revoked_on IS NOT NULL)`
  }

  async issueAccessToken (token: string, connection: string, expiresOn: number): Promise<void> {
    await this.sql`INSERT INTO openauth.access_token (hash, connection_id, expires_on)
      VALUES (${hash(token)}, ${connection}, ${expiresOn})`
  }

  async resolveAccessToken (token: string): Promise<{ connection: OAuthConnection, expiresOn: number } | undefined> {
    const rows = await this.sql<{ connection_id: string, expires_on: string }[]>`
      SELECT connection_id, expires_on FROM openauth.access_token
      WHERE hash = ${hash(token)} AND expires_on > ${Date.now()}`
    const row = rows[0]
    if (row === undefined) return undefined
    const connection = await this.getConnection(row.connection_id)
    return connection === undefined ? undefined : { connection, expiresOn: Number(row.expires_on) }
  }

  async cleanup (): Promise<void> {
    await this.sql`DELETE FROM openauth.storage WHERE expires_on IS NOT NULL AND expires_on <= ${Date.now()}`
    await this.sql`DELETE FROM openauth.access_token WHERE expires_on <= ${Date.now()}`
  }

  async close (): Promise<void> {
    await this.database.end({ timeout: 5 })
  }
}
