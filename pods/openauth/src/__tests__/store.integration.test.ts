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

import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import * as migrations from '../migrations'
import { OAuthStore } from '../store'

const databaseUrl = process.env.OPENAUTH_TEST_DATABASE_URL
const describeDatabase = databaseUrl === undefined ? describe.skip : describe

// Run only against a disposable database: initialization creates the issuer's private schema.
describeDatabase('persistent OAuth storage', () => {
  let store: OAuthStore
  const resource = 'https://mcp.example.test/mcp'
  const account = randomUUID()
  const connectionId = randomUUID()
  const counterKey = ['counter', randomUUID()]
  const rollbackKey = ['rollback', randomUUID()]

  beforeAll(async () => {
    store = new OAuthStore(databaseUrl ?? '', 'test-only-storage-secret')
    const replica = new OAuthStore(databaseUrl ?? '', 'test-only-storage-secret')
    try {
      await Promise.all([store.init(), replica.init()])
    } finally {
      await replica.close()
    }
  })
  afterAll(async () => {
    await store.close()
  })

  it('persists encrypted credentials and hashed bearer keys across issuer restarts', async () => {
    await store.createConnection({
      id: connectionId,
      account,
      clientId: 'test-client',
      clientName: 'Codex',
      resource,
      accountToken: 'private-account-token',
      createdOn: Date.now()
    })
    await store.set(
      ['oauth:refresh', connectionId, 'private-refresh-token'],
      { value: 'private-signing-material' },
      new Date(Date.now() + 60_000)
    )
    await store.issueAccessToken('private-access-token', connectionId, Date.now() + 60_000)
    await store.close()
    store = new OAuthStore(databaseUrl ?? '', 'test-only-storage-secret')
    await store.init()
    expect((await store.resolveAccessToken('private-access-token'))?.connection.accountToken).toBe(
      'private-account-token'
    )
    expect(await store.get(['oauth:refresh', connectionId, 'private-refresh-token'])).toEqual({
      value: 'private-signing-material'
    })
    const found: string[][] = []
    for await (const [key] of store.scan(['oauth:refresh', connectionId])) found.push(key)
    expect(found).toEqual([['oauth:refresh', connectionId, 'private-refresh-token']])
    const sql = postgres(databaseUrl ?? '')
    try {
      const records = JSON.stringify({
        storage: await sql`SELECT * FROM openauth.storage`,
        connections: await sql`SELECT * FROM openauth.connection`,
        tokens: await sql`SELECT * FROM openauth.access_token`
      })
      for (const secret of [
        'private-account-token',
        'private-refresh-token',
        'private-access-token',
        'private-signing-material'
      ]) {
        expect(records).not.toContain(secret)
      }
    } finally {
      await sql.end()
    }
  })

  it('adopts existing issuer tables without changing their credentials', async () => {
    const sql = postgres(databaseUrl ?? '')
    try {
      const before = await sql`SELECT account_token FROM openauth.connection WHERE id = ${connectionId}`
      await sql`DELETE FROM openauth.migrations WHERE name = 'openauth_db_v1_init'`
      await store.init()
      expect(await sql`SELECT account_token FROM openauth.connection WHERE id = ${connectionId}`).toEqual(before)
      expect((await store.resolveAccessToken('private-access-token'))?.connection.accountToken).toBe(
        'private-account-token'
      )
      expect(await sql`SELECT name FROM openauth.migrations`).toEqual([{ name: 'openauth_db_v1_init' }])
    } finally {
      await sql.end()
    }
  })

  it('applies pending migrations in order once across restarts and concurrent replicas', async () => {
    const sql = postgres(databaseUrl ?? '')
    const replica = new OAuthStore(databaseUrl ?? '', 'test-only-storage-secret')
    const initial = migrations.getMigrations()
    const registry = jest
      .spyOn(migrations, 'getMigrations')
      .mockReturnValue([
        ...initial,
        [
          'test_schema_v2',
          'CREATE TABLE openauth.migration_probe (value INTEGER NOT NULL); INSERT INTO openauth.migration_probe VALUES (1);'
        ],
        ['test_schema_v3', 'UPDATE openauth.migration_probe SET value = value + 1;']
      ])
    try {
      await Promise.all([store.init(), replica.init()])
      const history = await sql`SELECT name, created_on FROM openauth.migrations ORDER BY name`
      expect(history.map((row) => row.name)).toEqual(['openauth_db_v1_init', 'test_schema_v2', 'test_schema_v3'])
      await store.init()
      expect(await sql`SELECT name, created_on FROM openauth.migrations ORDER BY name`).toEqual(history)
      expect(await sql`SELECT value FROM openauth.migration_probe`).toEqual([{ value: 2 }])
    } finally {
      registry.mockRestore()
      await replica.close()
      await sql.end()
    }
  })

  it('rolls back schema changes and migration history when a pending migration fails', async () => {
    const sql = postgres(databaseUrl ?? '')
    const initial = migrations.getMigrations()
    const registry = jest
      .spyOn(migrations, 'getMigrations')
      .mockReturnValue([
        ...initial,
        ['test_schema_v4', 'CREATE TABLE openauth.migration_rollback_probe (value INTEGER NOT NULL);'],
        ['test_schema_v5', 'SELECT 1 / 0;']
      ])
    try {
      await expect(store.init()).rejects.toThrow('Failed to apply OAuth schema migration: test_schema_v5')
      expect(await sql`SELECT to_regclass('openauth.migration_rollback_probe') AS name`).toEqual([{ name: null }])
      expect(
        await sql`SELECT name FROM openauth.migrations WHERE name IN ('test_schema_v4', 'test_schema_v5')`
      ).toEqual([])
      expect(await store.get(['oauth:refresh', connectionId, 'private-refresh-token'])).toEqual({
        value: 'private-signing-material'
      })
      registry.mockReturnValue([
        ...initial,
        ['test_schema_v4', 'CREATE TABLE openauth.migration_rollback_probe (value INTEGER NOT NULL);'],
        ['test_schema_v5', 'INSERT INTO openauth.migration_rollback_probe VALUES (1);']
      ])
      await store.init()
      expect(await sql`SELECT value FROM openauth.migration_rollback_probe`).toEqual([{ value: 1 }])
    } finally {
      registry.mockRestore()
      await sql.end()
    }
  })

  it('serializes and rolls back token updates across independent issuer instances', async () => {
    const replica = new OAuthStore(databaseUrl ?? '', 'test-only-storage-secret')
    try {
      await Promise.all(
        [store, replica].map(async (instance) => {
          await instance.withLock('test-counter', async () => {
            const current = await instance.get(counterKey)
            await instance.set(counterKey, { count: Number(current?.count ?? 0) + 1 })
          })
        })
      )
      expect(await store.get(counterKey)).toEqual({ count: 2 })
      await expect(
        store.withLock('rollback', async () => {
          await store.set(rollbackKey, { value: true })
          throw new Error('Rollback this transaction')
        })
      ).rejects.toThrow('Rollback this transaction')
      expect(await store.get(rollbackKey)).toBeUndefined()
    } finally {
      await replica.close()
    }
  })

  it('enforces expiration, resource isolation, ownership, and immediate revocation', async () => {
    await store.set(['expired'], { value: true }, new Date(Date.now() - 1))
    expect(await store.get(['expired'])).toBeUndefined()
    expect(await store.listConnections(account, 'https://staging.example.test/mcp')).toEqual([])
    await store.revokeConnection(connectionId, randomUUID(), resource)
    expect(await store.resolveAccessToken('private-access-token')).toBeDefined()
    await store.revokeConnection(connectionId, account, 'https://staging.example.test/mcp')
    expect(await store.resolveAccessToken('private-access-token')).toBeDefined()
    await store.revokeConnection(connectionId, account, resource)
    expect(await store.resolveAccessToken('private-access-token')).toBeUndefined()
    expect(await store.getConnection(connectionId)).toBeUndefined()
    await store.cleanup()
  })
})
