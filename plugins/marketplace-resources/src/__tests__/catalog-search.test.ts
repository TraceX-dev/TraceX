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
import type { CatalogPackage, CatalogPage, CatalogSearch, MarketplaceClient } from '@hcengineering/marketplace'
import { listCatalogPackages } from '../catalog-search'

const processPackage: CatalogPackage = {
  id: 'review',
  author: 'author' as AccountUuid,
  owner: 'author' as AccountUuid,
  visibility: 'public',
  name: 'Review',
  description: '',
  kind: 'process',
  version: '1.0.0',
  authorName: 'Author',
  publishedOn: 1
}
const cardPackage: CatalogPackage = { ...processPackage, id: 'cards', kind: 'card' }
const cardPage: CatalogPage<CatalogPackage> = { items: [cardPackage] }
const mixedPage: CatalogPage<CatalogPackage> = { items: [processPackage, cardPackage] }
const emptyPage: CatalogPage<CatalogPackage> = { items: [] }
const searchOptions: CatalogSearch = { search: 'review' }
const continuationOptions: CatalogSearch = { offset: 60 }
const emptyOptions: CatalogSearch = {}
let list: jest.Mock<Promise<CatalogPage<CatalogPackage>>, [CatalogSearch?]>
let client: Pick<MarketplaceClient, 'list'>

beforeEach(() => {
  list = jest.fn()
  client = { list }
})

it('skips unrelated pages and retains search and the next matching page offset', async () => {
  const first: CatalogPage<CatalogPackage> = { ...cardPage, nextOffset: 20 }
  const second: CatalogPage<CatalogPackage> = { ...cardPage, nextOffset: 40 }
  const third: CatalogPage<CatalogPackage> = { ...mixedPage, nextOffset: 60 }
  const expected: CatalogPage<CatalogPackage> = { items: [processPackage], nextOffset: 60 }
  const requests: CatalogSearch[] = [
    { ...searchOptions, offset: undefined },
    { ...searchOptions, offset: 20 },
    { ...searchOptions, offset: 40 }
  ]
  list.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(third)

  expect(await listCatalogPackages(client, searchOptions, 'process')).toEqual(expected)
  expect(list.mock.calls.map(([options]) => options)).toEqual(requests)
})

it('continues from the supplied offset and filters card packages', async () => {
  list.mockResolvedValueOnce(mixedPage)
  expect(await listCatalogPackages(client, continuationOptions, 'card')).toEqual(cardPage)
  expect(list).toHaveBeenCalledWith(continuationOptions)
})

it('reports an empty catalog only after exhausting unrelated pages', async () => {
  const first: CatalogPage<CatalogPackage> = { ...cardPage, nextOffset: 20 }
  list.mockResolvedValueOnce(first).mockResolvedValueOnce(cardPage)
  expect(await listCatalogPackages(client, emptyOptions, 'process')).toEqual(emptyPage)
  expect(list).toHaveBeenCalledTimes(2)
})

it('keeps ordinary catalog pagination unchanged', async () => {
  const page: CatalogPage<CatalogPackage> = { ...mixedPage, nextOffset: 20 }
  const options: CatalogSearch = { mine: true }
  list.mockResolvedValueOnce(page)
  expect(await listCatalogPackages(client, options, undefined)).toEqual(page)
  expect(list).toHaveBeenCalledTimes(1)
})

it('stops requesting unrelated pages when the search is superseded or the popup closes', async () => {
  const page: CatalogPage<CatalogPackage> = { ...cardPage, nextOffset: 20 }
  list.mockResolvedValueOnce(page)
  await listCatalogPackages(client, emptyOptions, 'process', () => false)
  expect(list).toHaveBeenCalledTimes(1)
})

it('propagates transport errors to the catalog', async () => {
  list.mockRejectedValueOnce(new Error('offline'))
  await expect(listCatalogPackages(client, emptyOptions, 'process')).rejects.toThrow('offline')
})
