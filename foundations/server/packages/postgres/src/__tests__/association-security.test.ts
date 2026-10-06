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

import core, {
  AccountRole,
  Hierarchy,
  MeasureMetricsContext,
  ModelDb,
  type AccountUuid,
  type Association,
  type MeasureContext,
  type SessionData,
  systemAccountUuid,
  toFindResult,
  type WithLookup,
  type WorkspaceUuid
} from '@hcengineering/core'
import type { ConnectionMgr, DBClient, DBResult } from '@hcengineering/postgres-base'
import { PostgresAdapter } from '../storage'
import { genMinModel } from './minmodel'
import { createTaskModel, type Task, taskPlugin } from './tasks'

async function makeAdapter (
  role = AccountRole.User,
  system = false
): Promise<{
  adapter: PostgresAdapter
  ctx: MeasureContext<SessionData>
  association: Association
  execute: jest.Mock
  model: ModelDb
}> {
  const hierarchy = new Hierarchy()
  const model = new ModelDb(hierarchy)
  const txes = genMinModel()
  createTaskModel(txes)
  for (const tx of txes) {
    hierarchy.tx(tx)
  }
  for (const tx of txes) {
    await model.tx(tx)
  }
  const association = model.findAllSync(core.class.Association, {})[0]
  jest.spyOn(model, 'findAllSync').mockReturnValue(toFindResult([], 0))
  const execute = jest.fn(async (_sql: string, _params: unknown[]) => Object.assign([], { count: 0 }) as DBResult)
  const client = { execute } as unknown as DBClient
  const mgr = {
    retry: async (_id: string | undefined, _mgrId: string, fn: (client: DBClient) => Promise<unknown>) =>
      await fn(client)
  } as unknown as ConnectionMgr
  const adapter = new PostgresAdapter(
    client,
    mgr,
    { url: () => 'test', close: () => {} },
    '00000000-0000-0000-0000-000000000001' as WorkspaceUuid,
    hierarchy,
    model,
    'test'
  )
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    account: { uuid: system ? systemAccountUuid : ('test:account:user' as AccountUuid), role }
  } as unknown as SessionData
  return { adapter, ctx, association, execute, model }
}

function parentMap (): Map<string, WithLookup<Task>> {
  return new Map([['parent', {} as unknown as WithLookup<Task>]])
}

describe('PostgreSQL association access', () => {
  it.each([undefined, false])('keeps direct query security when unsecured is %s', async (unsecured) => {
    const { adapter, ctx, execute } = await makeAdapter()

    await adapter.findAll(ctx, taskPlugin.class.Task, {}, { unsecured })

    expect(execute.mock.calls[0][0]).toContain('sec.members @>')
  })

  it('bypasses security for direct queries and their total count when explicitly requested', async () => {
    const { adapter, ctx, execute } = await makeAdapter(AccountRole.Guest)
    execute.mockResolvedValueOnce(Object.assign([{ count: '0' }], { count: 1 }))
    execute.mockResolvedValueOnce(Object.assign([], { count: 0 }))

    await adapter.findAll(ctx, taskPlugin.class.Task, {}, { unsecured: true, total: true })

    expect(execute).toHaveBeenCalledTimes(2)
    for (const [sql] of execute.mock.calls) {
      expect(sql).not.toContain('sec.members @>')
      expect(sql).not.toContain('collab_sec')
      expect(sql).toContain('"workspaceId"')
    }
  })

  it('applies space access to the association target alias', async () => {
    const { adapter, ctx, association, execute } = await makeAdapter()

    await adapter.fetchAssociations(ctx, parentMap(), [[association._id, 1]])

    const sql = execute.mock.calls[0][0] as string
    expect(sql).toContain('sec._id = assoc.space')
    expect(sql).toContain('sec.members @>')
    expect(sql).toContain('sec.archived = false')
    expect(sql).toContain('assoc."workspaceId"')
  })

  it('uses guest collaborator checks against the target rather than its table name', async () => {
    const { adapter, ctx, association, execute, model } = await makeAdapter(AccountRole.Guest)
    jest.spyOn(model, 'findAllSync').mockReturnValue(
      toFindResult(
        [
          {
            attachedTo: taskPlugin.class.Task,
            provideSecurity: true,
            provideAttachedSecurity: true
          } as unknown as Task
        ],
        1
      )
    )

    await adapter.fetchAssociations(ctx, parentMap(), [[association._id, -1]])

    const sql = execute.mock.calls[0][0] as string
    expect(sql).toContain('collab_sec."attachedTo" = assoc._id')
    expect(sql).toContain('collab_sec."attachedTo" = assoc."attachedTo"')
    expect(sql).toContain('r."docA" = assoc."_id"')
  })

  it('honors archived-space options for association queries', async () => {
    const { adapter, ctx, association, execute } = await makeAdapter()

    await adapter.fetchAssociations(ctx, parentMap(), [[association._id, 1]], true)

    expect(execute.mock.calls[0][0]).not.toContain('sec.archived = false')
  })

  it('leaves system queries unrestricted', async () => {
    const { adapter, ctx, association, execute } = await makeAdapter(AccountRole.User, true)

    await adapter.fetchAssociations(ctx, parentMap(), [[association._id, 1]])

    expect(execute.mock.calls[0][0]).not.toContain('EXISTS')
  })
})
