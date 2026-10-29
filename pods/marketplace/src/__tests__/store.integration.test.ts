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
import { PostgresCatalogStore, type CatalogPublication } from '../store'

// Point only at a disposable database; these tests never use the service's DB_URL.
const databaseUrl = process.env.MARKETPLACE_TEST_DB_URL
const integration = databaseUrl === undefined ? describe.skip : describe
const author = '267c1923-5983-4ab0-ac89-82f481836724' as AccountUuid
const other = 'ac842ec2-bd9e-4f51-86ef-ce1393386348' as AccountUuid

integration('Marketplace PostgreSQL release storage', () => {
  let store: PostgresCatalogStore
  let publication: CatalogPublication
  beforeAll(async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('/tracex_marketplace_test')) {
      throw new Error('Use a disposable tracex_marketplace_test database')
    }
    store = new PostgresCatalogStore(databaseUrl)
    await store.init()
  })
  afterAll(async () => {
    await store?.close()
  })
  beforeEach(() => {
    publication = {
      id: `local/test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author,
      name: 'Process bundle',
      description: 'A % literal _ search',
      kind: 'process',
      version: '1.0.0',
      authorName: 'Author',
      publishedOn: Date.now(),
      contentHash: 'sha256:original',
      source: 'original YAML'
    }
  })

  it('keeps old release bytes and selects the newest release', async () => {
    await store.publish(publication)
    await store.publish({ ...publication, version: '1.0.1', contentHash: 'sha256:updated', source: 'updated YAML' })
    expect(await store.download(publication, '1.0.0')).toBe('original YAML')
    expect(await store.download(publication)).toBe('updated YAML')
    expect((await store.releases(publication, 0)).items.map((release) => release.version)).toEqual(['1.0.1', '1.0.0'])
  })

  it('accepts identical retries without changing the publication timestamp', async () => {
    const first = await store.publish(publication)
    expect(await store.publish({ ...publication, publishedOn: publication.publishedOn + 100 })).toEqual(first)
    expect((await store.releases(publication, 0)).items).toHaveLength(1)
  })

  it('rejects replacing content, kind changes, downgrades and equal SemVer precedence', async () => {
    await store.publish(publication)
    await expect(store.publish({ ...publication, contentHash: 'different' })).rejects.toMatchObject({ status: 409 })
    await expect(store.publish({ ...publication, version: '1.0.1', kind: 'card' })).rejects.toMatchObject({
      status: 409
    })
    await expect(store.publish({ ...publication, version: '0.9.0' })).rejects.toMatchObject({ status: 409 })
    await expect(store.publish({ ...publication, version: '1.0.0+changed' })).rejects.toMatchObject({ status: 409 })
    expect(await store.download(publication)).toBe('original YAML')
  })

  it('scopes package IDs to their real authors', async () => {
    await store.publish(publication)
    await store.publish({ ...publication, author: other, source: 'other author' })
    expect(await store.download(publication)).toBe('original YAML')
    expect(await store.download({ ...publication, author: other })).toBe('other author')
  })

  it('serializes concurrent first publications and never replaces a version', async () => {
    const results = await Promise.allSettled([
      store.publish(publication),
      store.publish({ ...publication, contentHash: 'different', source: 'different YAML' })
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await store.releases(publication, 0)).items).toHaveLength(1)
  })

  it('keeps the greatest SemVer latest under concurrent upgrades', async () => {
    await store.publish(publication)
    await Promise.allSettled(
      ['1.0.1', '1.0.2', '1.0.3'].map(async (version) => {
        await store.publish({ ...publication, version, source: version, contentHash: version })
      })
    )
    expect(await store.download(publication)).toBe('1.0.3')
  })

  it('searches literal text, filters authors and exposes optional contact only when supplied', async () => {
    await store.publish(publication)
    const page = await store.list({ search: '% literal _', author, offset: 0, limit: 100 })
    expect(page.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: publication.id })]))
    expect(page.items.find((entry) => entry.id === publication.id)?.contactEmail).toBeUndefined()
    expect(
      (await store.list({ search: publication.name, author: other, offset: 0, limit: 100 })).items.every(
        (entry) => entry.author === other
      )
    ).toBe(true)
    await expect(store.download({ ...publication, id: 'local/missing' })).rejects.toMatchObject({ status: 404 })
  })
})
