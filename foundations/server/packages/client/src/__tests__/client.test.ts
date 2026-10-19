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

import client, { type ClientFactoryOptions } from '@hcengineering/client'
import core, { TxFactory, type Client, type FullModelResponse, type TxPersistenceStore } from '@hcengineering/core'
import { getMetadata, getResource, setMetadata } from '@hcengineering/platform'
import { createHash } from 'node:crypto'
import { createClient } from '../client'

jest.mock('@hcengineering/platform', () => ({
  __esModule: true,
  ...jest.requireActual('@hcengineering/platform'),
  addLocation: jest.fn(),
  getResource: jest.fn()
}))

const factory = new TxFactory(core.account.System)
const model: FullModelResponse = {
  kind: 'full',
  hash: 'a'.repeat(40) + ':user',
  systemTx: [factory.createTxCreateDoc(core.class.Doc, core.space.Model, {})],
  userTx: [factory.createTxCreateDoc(core.class.Doc, core.space.Model, {})]
}
let initialModels: FullModelResponse[]
let stores: TxPersistenceStore[]

beforeEach(() => {
  initialModels = []
  stores = []
  setMetadata(client.metadata.OverridePersistenceStore, undefined)
  jest
    .mocked(getResource)
    .mockResolvedValue(async (_token: string, _endpoint: string, options?: ClientFactoryOptions) => {
      const persistence = options?.txPersistence
      if (persistence === undefined) throw new Error('Missing connection persistence')
      stores.push(persistence)
      initialModels.push(await persistence.load())
      await persistence.store(model)
      return { close: jest.fn() } as unknown as Client
    })
})

afterEach(() => {
  setMetadata(client.metadata.OverridePersistenceStore, undefined)
})

it('keeps the latest model scoped to each service client', async () => {
  await createClient('ws://server', 'token-a')
  await createClient('ws://server', 'token-b')

  expect(initialModels.map((model) => model.hash)).toEqual(['', ''])
  expect(stores[0]).not.toBe(stores[1])
  const updated = { ...model, hash: model.hash + '-updated' }
  await stores[0].store(updated)
  expect(await stores[0].load()).toEqual(updated)
  expect(await stores[1].load()).toEqual(model)
  expect(getMetadata(client.metadata.OverridePersistenceStore)).toBeUndefined()
})

it('keeps an explicitly supplied model scoped to its own connection', async () => {
  const system = model.systemTx
  await createClient('ws://explicit-model', 'token-a', system)
  await createClient('ws://another-backend', 'token-b')

  expect(initialModels[0].hash).toBe(createHash('sha1').update(JSON.stringify(system)).digest('hex'))
  expect(initialModels[0]).toMatchObject({ systemTx: system, userTx: [] })
  expect(initialModels[1].hash).toBe('')
  expect(getMetadata(client.metadata.OverridePersistenceStore)).toBeUndefined()
})

it('preserves an explicitly configured persistence override', async () => {
  const override = { load: async () => model, store: jest.fn().mockResolvedValue(undefined) }
  setMetadata(client.metadata.OverridePersistenceStore, override)
  await createClient('ws://custom-persistence', 'token')

  expect(initialModels[0]).toEqual(model)
  expect(override.store).toHaveBeenCalledWith(model)
  expect(getMetadata(client.metadata.OverridePersistenceStore)).toBe(override)
})
