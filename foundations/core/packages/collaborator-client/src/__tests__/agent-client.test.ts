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

import type { WorkspaceUuid } from '@hcengineering/core'
import { getClient } from '../client'
import { CollaboratorAgentError } from '../agent-client'
import type { AgentApiErrorResponse, AgentOperation, ApplyAgentOpsResponse, GetAgentSchemaResponse } from '../agent'

const workspace = 'workspace' as WorkspaceUuid
const docName = 'workspace|class|document/id|content'
const baseUrl = 'http://collaborator.test'
const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn()
const originalFetch = globalThis.fetch

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock
})
afterEach(() => { globalThis.fetch = originalFetch })

it('uses the shared schema endpoint with bearer authentication', async () => {
  const output: GetAgentSchemaResponse = { topNode: 'doc', nodes: {}, marks: {} }
  fetchMock.mockResolvedValue(new Response(JSON.stringify(output)))
  const client = getClient(workspace, 'test-token', baseUrl)
  await expect(client.getAgentSchema()).resolves.toEqual(output)
  expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/api/v1/agent/schema`, {
    method: 'GET', headers: { Authorization: 'Bearer test-token', Accept: 'application/json' }
  })
})

it('encodes document names, node handles and query parameters', async () => {
  fetchMock.mockImplementation(async () => new Response('{}'))
  const client = getClient(workspace, 'test-token', baseUrl)
  await client.getAgentOutline({ docName, from: 0, limit: 25 })
  await client.findAgentNodes({ docName, text: 'a & b', type: 'heading', from: 0, limit: 10 })
  await client.readAgentNode({ docName, ref: 'a.0' })
  const documentPath = `${baseUrl}/api/v1/agent/${encodeURIComponent(docName)}`
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    `${documentPath}/outline?from=0&limit=25`,
    `${documentPath}/find?text=a+%26+b&type=heading&from=0&limit=10`,
    `${documentPath}/nodes/a.0`
  ])
})

it('posts only the operation body and preserves a known atomic rejection', async () => {
  const ops: AgentOperation[] = [{ op: 'delete_node', ref: 'a.0', expect: { hash: 'subtree-hash' } }]
  const output: ApplyAgentOpsResponse = {
    ok: false, opIndex: 0, error: { code: 'STALE_REFERENCE', message: 'Read again.' }
  }
  fetchMock.mockResolvedValue(new Response(JSON.stringify(output)))
  const client = getClient(workspace, 'test-token', baseUrl)
  await expect(client.applyAgentOps({ docName, ops })).resolves.toEqual(output)
  expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/api/v1/agent/${encodeURIComponent(docName)}/ops`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops })
  })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('preserves structured HTTP errors without retrying', async () => {
  const output: AgentApiErrorResponse = {
    error: { code: 'not_implemented', message: 'Not implemented.', retryable: false }
  }
  fetchMock.mockResolvedValue(new Response(JSON.stringify(output), { status: 501 }))
  const client = getClient(workspace, 'test-token', baseUrl)
  await expect(client.getAgentSchema()).rejects.toMatchObject({
    name: 'CollaboratorAgentError', code: 'not_implemented', message: 'Not implemented.', status: 501, retryable: false
  })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('does not retry a write after a network failure or an unreadable response', async () => {
  const client = getClient(workspace, 'test-token', baseUrl)
  const ops: AgentOperation[] = [{ op: 'replace_text', ref: 'a.0', search: 'before', replace: 'after' }]
  fetchMock.mockRejectedValueOnce(new Error('connection reset'))
  await expect(client.applyAgentOps({ docName, ops })).rejects.toMatchObject({
    code: 'collaborator_unavailable', retryable: false, message: expect.stringContaining('outcome may be unknown')
  })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fetchMock.mockResolvedValueOnce(new Response('not JSON'))
  await expect(client.applyAgentOps({ docName, ops })).rejects.toMatchObject({
    code: 'invalid_response', retryable: false, message: expect.stringContaining('outcome may be unknown')
  })
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('rejects malformed and foreign document names before making a request', async () => {
  const client = getClient(workspace, 'test-token', baseUrl)
  await expect(client.readAgentNode({ docName: 'document', ref: 'a.0' })).rejects.toBeInstanceOf(CollaboratorAgentError)
  await expect(client.getAgentOutline({ docName: 'other|class|document|content' })).rejects.toMatchObject({ code: 'forbidden' })
  expect(fetchMock).not.toHaveBeenCalled()
})
