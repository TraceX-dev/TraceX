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

import core, { generateId, type Tx, type OperationDomain, SocialIdType } from '@hcengineering/core'
import { createRestClient, RestClientImpl } from '../rest/rest'

describe('REST request timeout', () => {
  const originalFetch = globalThis.fetch
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
  let timeoutMock: jest.SpyInstance<AbortSignal, [number]>
  const tx: Tx = {
    _id: generateId<Tx>(),
    _class: core.class.Tx,
    space: core.space.Tx,
    objectSpace: core.space.Space,
    modifiedOn: 0,
    modifiedBy: core.account.System
  }

  beforeEach(() => {
    jest.useFakeTimers()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
    timeoutMock = jest.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController()
      setTimeout(() => {
        controller.abort(new DOMException('Request timed out', 'TimeoutError'))
      }, ms)
      return controller.signal
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('aborts each stalled request after one minute and fails after three attempts', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = init?.signal
      if (signal == null) throw new Error('Missing abort signal')
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(signal.reason)
          },
          { once: true }
        )
      })
    })
    const client = new RestClientImpl('http://localhost', 'workspace', 'test-token')
    const result = client.findAll(core.class.Doc, {}).catch((err: unknown) => err)

    await jest.advanceTimersByTimeAsync(59_999)
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await jest.runAllTimersAsync()
    expect(await result).toMatchObject({ name: 'TimeoutError' })
    expect(timeoutMock).toHaveBeenCalledWith(60_000)
    expect(timeoutMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([, init]) => init?.signal?.aborted)).toEqual([true, true, true])
  })

  it('aborts reading each stalled response body and fails after three attempts', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = init?.signal
      if (signal == null) throw new Error('Missing abort signal')
      return new Response(
        new ReadableStream({
          start (controller) {
            signal.addEventListener(
              'abort',
              () => {
                controller.error(new DOMException('Body aborted', 'AbortError'))
              },
              { once: true }
            )
          }
        })
      )
    })
    const client = new RestClientImpl('http://localhost', 'workspace', 'test-token')
    const result = client.findAll(core.class.Doc, {}).catch((err: unknown) => err)

    await jest.runAllTimersAsync()
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([, init]) => init?.signal?.aborted)).toEqual([true, true, true])
  })

  it('uses a configurable timeout through the public factory', async () => {
    fetchMock.mockResolvedValue(new Response('[]'))
    const client = createRestClient('http://localhost', 'workspace', 'test-token', { requestTimeout: 5000 })

    await expect(client.findAll(core.class.Doc, {})).resolves.toEqual([])
    expect(timeoutMock).toHaveBeenCalledWith(5000)
  })

  it('allows disabling the timeout explicitly', () => {
    const client = new RestClientImpl('http://localhost', 'workspace', 'test-token', { requestTimeout: 0 })

    expect(client.requestInit().signal).toBeUndefined()
    expect(timeoutMock).not.toHaveBeenCalled()
  })

  it.each([-1, NaN, Infinity, 0.5])('rejects invalid timeout %s', (requestTimeout) => {
    expect(() => createRestClient('http://localhost', 'workspace', 'test-token', { requestTimeout })).toThrow(
      RangeError
    )
  })

  it.each([
    ['getAccount', (client: RestClientImpl) => client.getAccount()],
    ['getModel', (client: RestClientImpl) => client.getModel()],
    ['tx', (client: RestClientImpl) => client.tx(tx)],
    ['searchFulltext', (client: RestClientImpl) => client.searchFulltext({ query: 'test' }, {})],
    ['domainRequest', (client: RestClientImpl) => client.domainRequest('test' as OperationDomain, {})],
    ['ensurePerson', (client: RestClientImpl) => client.ensurePerson(SocialIdType.EMAIL, 'test@example.com', 'A', 'B')],
    ['createDoc', (client: RestClientImpl) => client.createDoc(core.class.Doc, core.space.Space, {})]
  ] as const)('applies the timeout to every %s attempt', async (_method, request) => {
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = init?.signal
      if (signal == null) throw new Error('Missing abort signal')
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(signal.reason)
          },
          { once: true }
        )
      })
    })
    const client = new RestClientImpl('http://localhost', 'workspace', 'test-token')
    const result = request(client).catch((err: unknown) => err)

    await jest.runAllTimersAsync()
    expect(await result).toMatchObject({ name: 'TimeoutError' })
    expect(timeoutMock).toHaveBeenCalledTimes(3)
    expect(timeoutMock).toHaveBeenCalledWith(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([, init]) => init?.signal?.aborted)).toEqual([true, true, true])
  })
})
