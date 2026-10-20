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

import { ConnectionMgr, type DBClient } from '../index'

describe('ConnectionMgr shutdown', () => {
  it.each([undefined, 'workspace'])('releases an in-flight reservation after close(%s)', async (mgrId) => {
    const release = jest.fn()
    const reserved: DBClient = {
      execute: jest.fn<ReturnType<DBClient['execute']>, Parameters<DBClient['execute']>>(),
      release,
      reserve: jest.fn<ReturnType<DBClient['reserve']>, []>(),
      raw: jest.fn<ReturnType<DBClient['raw']>, []>()
    }
    const pool: DBClient = { ...reserved, release: jest.fn(), reserve: jest.fn().mockResolvedValue(reserved) }
    const manager = new ConnectionMgr(pool)
    manager.getConnection('request', 'workspace')
    let finish: () => void = () => {}
    const pending = new Promise<void>((resolve) => { finish = resolve })
    let markStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const request = manager.retry('request', 'workspace', async () => {
      markStarted()
      await pending
      return 'done'
    })
    await started

    manager.close(mgrId)
    expect(release).not.toHaveBeenCalled()
    finish()
    await expect(request).resolves.toBe('done')

    expect(release).toHaveBeenCalledTimes(1)
  })
})
