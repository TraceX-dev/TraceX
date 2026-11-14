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

import { createRestClient, loadServerConfig } from '@hcengineering/api-client'
import { getClient as getAccountClient, type AccountClient } from '@hcengineering/account-client'
import { generateId, type Class, type Doc, type Ref, type WorkspaceUuid } from '@hcengineering/core'

/**
 * End-to-end check that a workspace is created from the init script (see ws-tests/init-data-test.sh).
 */
const describeInit = process.env.INIT_DATA_TEST === 'true' ? describe : describe.skip

const ControlledDocument = 'documents:class:ControlledDocument' as Ref<Class<Doc>>
const CREATE_TIMEOUT_MS = 5 * 60 * 1000

interface ControlledDoc extends Doc {
  title: string
  code: string
  seqNumber: number
}

describeInit('workspace creation with initial data', () => {
  let accountClient: AccountClient
  let workspace: WorkspaceUuid
  let workspaceUrl: string

  async function waitActive (): Promise<void> {
    const started = Date.now()
    let last = 'not found'
    while (Date.now() - started < CREATE_TIMEOUT_MS) {
      const info = (await accountClient.getUserWorkspaces()).find((it) => it.uuid === workspace)
      if (info !== undefined) {
        last = `mode=${info.mode} attempts=${info.processingAttemps} progress=${info.processingProgress ?? 0}`
        if (info.mode === 'active') return
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    throw new Error(`Workspace ${workspace} was not created in time, last status: ${last}`)
  }

  beforeAll(async () => {
    const config = await loadServerConfig('http://tracex.local:8083')
    const { token } = await getAccountClient(config.ACCOUNTS_URL).login('user1', '1234')
    accountClient = getAccountClient(config.ACCOUNTS_URL, token)

    const created = await accountClient.createWorkspace(`init-data-${generateId().slice(-6)}`)
    workspace = created.workspace
    workspaceUrl = created.workspaceUrl
    await waitActive()
  }, CREATE_TIMEOUT_MS + 30000)

  it('creates controlled documents from the init script', async () => {
    const ws = await accountClient.selectWorkspace(workspaceUrl)
    const client = createRestClient(ws.endpoint, ws.workspace, ws.token)

    const docs = (await client.findAll(ControlledDocument, {})) as unknown as ControlledDoc[]
    const titles = docs.map((it) => it.title)

    expect(titles).toEqual(
      expect.arrayContaining(['Procedure Template', 'Change Management Procedure', 'Manage a change'])
    )
    // Every document got its own code and number from the sequences
    expect(new Set(docs.map((it) => it.code)).size).toBe(docs.length)
    expect(docs.every((it) => it.seqNumber > 0)).toBe(true)
  })
})
