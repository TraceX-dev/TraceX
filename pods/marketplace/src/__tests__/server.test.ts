// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { AccountUuid } from '@hcengineering/core'
import {
  createDefinitionPackageRelease,
  serializeDefinitionPackageRelease,
  MarketplaceClient,
  MarketplaceError
} from '@hcengineering/marketplace'
import { readFileSync } from 'fs'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { CatalogError } from '../errors'
import { createCatalogServer } from '../server'
import type { CatalogStore } from '../store'

const author = '267c1923-5983-4ab0-ac89-82f481836724' as AccountUuid
const stranger = 'ac842ec2-bd9e-4f51-86ef-ce1393386348' as AccountUuid
const identity = { id: 'acme/review', author }
const definition = readFileSync(
  `${__dirname}/../../../../plugins/process/docs/examples/review-task.process.yaml`,
  'utf8'
)

async function artifact (owner = author): Promise<string> {
  return serializeDefinitionPackageRelease(
    await createDefinitionPackageRelease({
      package: { ...identity, author: owner, version: '1.0.0', description: 'Review process' },
      source: definition
    })
  )
}

describe('Marketplace HTTP boundary', () => {
  let server: Server
  let url: string
  let client: MarketplaceClient
  const store: jest.Mocked<CatalogStore> = {
    list: jest.fn(),
    releases: jest.fn(),
    download: jest.fn(),
    publish: jest.fn()
  }
  const onError = jest.fn()
  beforeAll(async () => {
    server = createCatalogServer({
      store,
      onError,
      authenticate: async (token) => {
        if (token !== 'signed-account') throw new CatalogError(401, 'Invalid token')
        return { uuid: author, name: 'Test Author' }
      }
    }).listen(0, '127.0.0.1')
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    client = new MarketplaceClient(url, 'signed-account')
  })
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('requires authentication before reading a publication', async () => {
    const response = await fetch(`${url}/releases`, { method: 'POST', body: 'invalid YAML' })
    expect(response.status).toBe(401)
    await expect(new MarketplaceClient(url, 'bad-token').list()).rejects.toMatchObject({ status: 401 })
    expect(store.publish).not.toHaveBeenCalled()
  })

  it('lists catalog entries with a server-selected author for My publications', async () => {
    store.list.mockResolvedValue({ items: [], nextOffset: 2 })
    expect(await client.list({ mine: true, search: 'review', offset: 1, limit: 1 })).toEqual({
      items: [],
      nextOffset: 2
    })
    expect(store.list).toHaveBeenCalledWith({ search: 'review', author, offset: 1, limit: 1 })
    await client.list({ search: '' })
    expect(store.list).toHaveBeenLastCalledWith({ search: '', offset: 0, limit: 30 })
  })

  it('transfers raw YAML and uses the authenticated account name', async () => {
    const source = await artifact()
    store.publish.mockResolvedValue({ ...identity, version: '1.0.0', contentHash: 'digest', publishedOn: 1 })
    await client.publish(source, 'author@example.com')
    expect(store.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        ...identity,
        name: 'Review card',
        authorName: 'Test Author',
        contactEmail: 'author@example.com',
        version: '1.0.0',
        description: 'Review process',
        kind: 'process'
      })
    )
    expect(store.publish.mock.calls[0][0].source).toContain('processes:')
    expect(store.publish.mock.calls[0][0].source).not.toMatch(/^source:/m)
  })

  it('rejects a copied release attributed to another account', async () => {
    await expect(client.publish(await artifact(stranger))).rejects.toMatchObject({ status: 403 })
    expect(store.publish).not.toHaveBeenCalled()
  })

  it('rejects a modified release digest and malformed definitions before storage', async () => {
    await expect(client.publish((await artifact()).replace('Review card', 'Changed card'))).rejects.toMatchObject({
      status: 400
    })
    await expect(client.publish('version: 2\nkind: process\npackage: {}')).rejects.toBeInstanceOf(MarketplaceError)
    expect(store.publish).not.toHaveBeenCalled()
  })

  it('keeps contact optional and validates it without treating it as ownership', async () => {
    await client.publish(await artifact())
    expect(store.publish.mock.calls[0][0].contactEmail).toBeUndefined()
    await expect(client.publish(await artifact(), 'invalid')).rejects.toMatchObject({ status: 400 })
    expect(store.publish).toHaveBeenCalledTimes(1)
  })

  it('downloads the requested author/version and paginates history', async () => {
    store.download.mockResolvedValue('version: 2\n')
    expect(await client.download(identity, '1.0.0')).toBe('version: 2\n')
    expect(store.download).toHaveBeenCalledWith(identity, '1.0.0')
    store.releases.mockResolvedValue({ items: [] })
    await client.releases(identity, 50)
    expect(store.releases).toHaveBeenCalledWith(identity, 50)
  })

  it('rejects invalid pagination, identity, content type and oversized input', async () => {
    expect(
      (await fetch(`${url}/packages?limit=-1`, { headers: { Authorization: 'Bearer signed-account' } })).status
    ).toBe(400)
    expect(
      (
        await fetch(`${url}/release?id=acme/review&author=invalid`, {
          headers: { Authorization: 'Bearer signed-account' }
        })
      ).status
    ).toBe(400)
    const headers = { Authorization: 'Bearer signed-account', 'Content-Type': 'application/json' }
    expect((await fetch(`${url}/releases`, { method: 'POST', headers, body: '{}' })).status).toBe(415)
    await expect(client.publish('x'.repeat(3 * 1024 * 1024 + 1))).rejects.toMatchObject({ status: 413 })
    expect(store.publish).not.toHaveBeenCalled()
  })

  it('preserves conflict errors and hides internal storage failures', async () => {
    store.publish.mockRejectedValueOnce(new CatalogError(409, 'Version already exists'))
    await expect(client.publish(await artifact())).rejects.toMatchObject({
      status: 409,
      message: 'Version already exists'
    })
    store.list.mockRejectedValueOnce(new Error('private connection details'))
    await expect(client.list()).rejects.toMatchObject({ status: 500, message: 'Marketplace request failed' })
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
