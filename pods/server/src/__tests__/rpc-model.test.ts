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
  ClassifierKind,
  MeasureMetricsContext,
  TxFactory,
  type LoadModelResponse,
  type PersonUuid,
  type Tx,
  type WorkspaceUuid
} from '@hcengineering/core'
import { getMetadata, setMetadata } from '@hcengineering/platform'
import type { IntlString } from '@hcengineering/platform'
import type { ClientSessionCtx, SessionManager } from '@hcengineering/server-core'
import serverToken, { generateToken } from '@hcengineering/server-token'
import type { Express, Request, RequestHandler, Response } from 'express'
import { registerRPC } from '../rpc'

const workspace = '35efecdf-97c9-4ad5-b832-fe5809bcf074' as WorkspaceUuid
const factory = new TxFactory(core.account.System)
const hierarchyTx = factory.createTxCreateDoc(core.class.Class, core.space.Model, {
  label: 'Test' as IntlString,
  kind: ClassifierKind.CLASS
})
const otherTx = factory.createTxCreateDoc(core.class.Doc, core.space.Model, {})

describe('REST model response protocol', () => {
  const oldSecret = getMetadata(serverToken.metadata.Secret)

  beforeAll(() => {
    setMetadata(serverToken.metadata.Secret, 'model-test-secret')
  })

  afterAll(() => {
    setMetadata(serverToken.metadata.Secret, oldSecret)
  })

  async function request (result: LoadModelResponse | Tx[], full?: boolean): Promise<unknown> {
    const ctx = new MeasureMetricsContext('test', {})
    const session = { loadModelRaw: jest.fn().mockResolvedValue(result) }
    const sessionCtx = {
      pipeline: { context: { hierarchy: { isDerived: (a: string, b: string) => a === b } } }
    } as unknown as ClientSessionCtx
    const sessions = {
      addSession: async () => ({ session, workspaceId: workspace, context: ctx }),
      handleRPC: async (...args: Parameters<SessionManager['handleRPC']>) => {
        await args[4](sessionCtx)
        return undefined
      }
    } as unknown as SessionManager
    const get = jest.fn()
    registerRPC({ get, post: jest.fn() } as unknown as Express, sessions, ctx, 'http://accounts')
    const handler = get.mock.calls.find(([path]) => path === '/api/v1/load-model/:workspaceId')?.[1] as RequestHandler
    const token = generateToken('95abed00-35e6-4b5c-8ac7-c5f7925d0308' as PersonUuid, workspace)
    const req = {
      params: { workspaceId: workspace },
      headers: { authorization: 'Bearer ' + token },
      query: {
        ...(full === undefined ? {} : { full: String(full) }),
        ...(Array.isArray(result) ? {} : { lastHash: 'base-hash' })
      }
    } as unknown as Request
    const writeHead = jest.fn()
    const body = await new Promise<unknown>((resolve) => {
      const res = {
        writeHead,
        end: (body: Buffer) => {
          resolve(JSON.parse(body.toString()))
        }
      } as unknown as Response
      handler(req, res, jest.fn())
    })
    expect(writeHead.mock.calls[0][0]).toBe(200)
    expect(session.loadModelRaw).toHaveBeenCalledWith(sessionCtx, 0, Array.isArray(result) ? undefined : 'base-hash')
    return body
  }

  it.each([undefined, false, true])('preserves complete versioned responses with full=%s', async (full) => {
    const responses: LoadModelResponse[] = [
      { kind: 'full', hash: 'system:workspace-hash', systemTx: [hierarchyTx], userTx: [otherTx] },
      { kind: 'user', hash: 'system:workspace-hash', userTx: [otherTx] },
      { kind: 'delta', hash: 'system:workspace-hash', transactions: [hierarchyTx, otherTx] }
    ]
    for (const response of responses) {
      expect(await request(response, full)).toEqual(response)
    }
  })

  it.each([undefined, false, true])('preserves legacy transaction arrays with full=%s', async (full) => {
    const transactions = [hierarchyTx, otherTx]
    expect(await request(transactions, full)).toEqual(full ? transactions : [hierarchyTx])
  })
})
