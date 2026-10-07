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

import postgres from 'postgres'
import { closeDB, getDB, RecordStorage } from '../storage'
import type { UserRecord } from '../types'

jest.mock('postgres', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../config', () => ({
  __esModule: true,
  default: { DbUrl: 'postgresql://localhost/test', ServiceID: 'telegram-test' }
}))

describe('Telegram PostgreSQL storage', () => {
  const user: UserRecord = {
    phone: '+123456789',
    workspace: 'workspace-one',
    userId: 'user-one',
    email: 'person@example.com',
    token: 'session-token'
  }
  const query = jest.fn(
    async (_sql: TemplateStringsArray, _values: unknown[]): Promise<Array<{ data: UserRecord }>> => []
  )
  const end = jest.fn(async () => {})
  const client = Object.assign(
    (sql: string | TemplateStringsArray, ...values: unknown[]) => {
      if (typeof sql === 'string') return { identifier: sql }
      return query(sql, values)
    },
    { end }
  ) as unknown as postgres.Sql
  const records = new RecordStorage<UserRecord>(client, 'telegram_service.integrations')

  beforeEach(() => {
    query.mockReset()
    query.mockResolvedValue([])
    end.mockClear()
    jest.mocked(postgres).mockReset().mockReturnValue(client)
  })

  afterEach(async () => {
    await closeDB()
  })

  it('binds workspace filters and maps stored JSON records', async () => {
    query.mockResolvedValueOnce([{ data: user }])
    expect(await records.find({ workspace: user.workspace })).toEqual([user])
    expect(query.mock.calls[0][1]).toEqual([
      { identifier: 'telegram_service.integrations' },
      JSON.stringify({ workspace: user.workspace })
    ])
    expect(await records.findOne({ email: 'missing@example.com' })).toBeNull()
  })

  it('stores the generated identifier inside the record for subsequent updates', async () => {
    const id = await records.insertOne(user)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const values = query.mock.calls[0][1]
    expect(values[1]).toBe(id)
    expect(JSON.parse(values[2] as string)).toEqual({ ...user, _id: id })
  })

  it('merges partial updates and limits updates and single deletes to one matching record', async () => {
    await records.updateOne({ _id: 'record-id' }, { token: 'updated-token' })
    const [sql, values] = query.mock.calls[0]
    expect(sql.join('?')).toContain('SET data = data ||')
    expect(sql.join('?')).toContain('LIMIT 1')
    expect(values).toContain(JSON.stringify({ _id: 'record-id' }))
    expect(values).toContain(JSON.stringify({ token: 'updated-token' }))

    await records.deleteOne({ workspace: user.workspace })
    expect(query.mock.calls[1][0].join('?')).toContain('LIMIT 1')
    await records.deleteMany({ workspace: user.workspace })
    expect(query.mock.calls[2][0].join('?')).not.toContain('LIMIT 1')
    expect(query.mock.calls[2][1]).toContain(JSON.stringify({ workspace: user.workspace }))
  })

  it('shares initialization across callers and closes the client', async () => {
    const [first, second] = await Promise.all([getDB(), getDB()])
    expect(first).toBe(second)
    expect(postgres).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(7)
    await closeDB()
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('closes a failed initialization and allows a later retry', async () => {
    query.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(getDB()).rejects.toThrow('Database unavailable')
    expect(end).toHaveBeenCalledTimes(1)
    await expect(getDB()).resolves.toBeDefined()
    expect(postgres).toHaveBeenCalledTimes(2)
  })
})
