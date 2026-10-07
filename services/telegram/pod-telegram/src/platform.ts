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
import type { RecordStorage } from './storage'
import { getDB } from './storage'
import { LastMsgRecord, TgUser, User, UserRecord, WorkspaceChannel } from './types'
import { WorkspaceWorker } from './workspace'
import { StorageAdapter } from '@hcengineering/server-core'
import { MeasureContext } from '@hcengineering/core'

export class PlatformWorker {
  private constructor (
    private readonly ctx: MeasureContext,
    private readonly storageAdapter: StorageAdapter,
    private readonly clientMap: Map<string, WorkspaceWorker>,
    private readonly storage: RecordStorage<UserRecord>
  ) {}

  async close (): Promise<void> {
    await Promise.all(
      [...this.clientMap.values()].map(async (worker) => {
        await worker.close()
      })
    )
  }

  async addUser (tgUser: TgUser): Promise<void> {
    const { workspace, phone } = tgUser as any // TODO: FIXME
    const res = await this.storage.findOne({ phone, workspace })

    if (res !== null) {
      throw Error('Phone number is already used')
    }

    let wsWorker = this.clientMap.get(workspace)

    if (wsWorker === undefined) {
      const [userStorage, lastMsgStorage, channelStorage] = await PlatformWorker.createStorages()
      wsWorker = await WorkspaceWorker.create(
        this.ctx,
        this.storageAdapter,
        workspace,
        userStorage,
        lastMsgStorage,
        channelStorage
      )
      this.clientMap.set(workspace, wsWorker)
    }

    await wsWorker.addUser(tgUser)
  }

  async getTarget ({ workspace, email }: User): Promise<[UserRecord, WorkspaceWorker | undefined]> {
    const res = await this.storage.findOne({ email, workspace })

    if (res === null) {
      throw Error('User is not signed in')
    }

    return [res, this.clientMap.get(workspace)]
  }

  async removeUser (user: User): Promise<void> {
    const [res, wsWorker] = await this.getTarget(user)

    if (wsWorker === undefined) {
      throw Error(`Invalid workspace: '${user.workspace}'`)
    }

    await wsWorker.removeUser({ phone: res.phone })
  }

  async getUserRecord ({ workspace, phone }: Pick<TgUser, 'workspace' | 'phone'>): Promise<UserRecord | undefined> {
    return (await this.storage.findOne({ phone, workspace })) ?? undefined
  }

  static async createStorages (): Promise<
    [RecordStorage<UserRecord>, RecordStorage<LastMsgRecord>, RecordStorage<WorkspaceChannel>]
  > {
    const { users, messages, channels } = await getDB()
    return [users, messages, channels]
  }

  static async create (ctx: MeasureContext, storageAdapter: StorageAdapter): Promise<PlatformWorker> {
    const [userStorage, lastMsgStorage, channelStorage] = await PlatformWorker.createStorages()
    const workspaces = new Set((await userStorage.find()).map((p) => p.workspace))
    const clients: Array<[string, WorkspaceWorker]> = []
    for (const workspace of workspaces) {
      try {
        const worker = await WorkspaceWorker.create(
          ctx,
          storageAdapter,
          workspace as any, // TODO: FIXME
          userStorage,
          lastMsgStorage,
          channelStorage
        )
        clients.push([workspace, worker])
        void worker.checkUsers()
      } catch (e) {
        console.error(`Failed to initialize workspace worker: ${workspace}`)
        console.error(e)
      }
    }

    const res = clients.filter((client): client is [string, WorkspaceWorker] => client !== undefined)

    const worker = new PlatformWorker(ctx, storageAdapter, new Map(res), userStorage)

    return worker
  }
}
