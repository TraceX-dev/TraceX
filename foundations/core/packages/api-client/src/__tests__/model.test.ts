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
  ClientConnectEvent,
  createClient,
  DOMAIN_MODEL,
  getModelTransactions,
  mergeModelResponse,
  isFullModelResponse,
  TxFactory,
  type Class,
  type ClientConnection,
  type Doc,
  type LoadModelResponse,
  type Ref,
  type Tx
} from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import { createHash, webcrypto } from 'node:crypto'
import { createModelPersistence, createModelSnapshot } from '../model'
import { createRestClient } from '../rest/rest'
import { createRestTxOperations } from '../rest/tx'

interface Item extends Doc {
  count: number
}

const factory = new TxFactory(core.account.System)
const itemClass = 'test:class:Item' as Ref<Class<Item>>
const itemId = 'test:doc:Item' as Ref<Item>

function baseModel (): Tx[] {
  const classes: Ref<Class<Doc>>[] = [core.class.Obj, core.class.Doc, core.class.Class, itemClass]
  const txes: Tx[] = classes.map((id) =>
    factory.createTxCreateDoc(
      core.class.Class,
      core.space.Model,
      {
        label: 'Test' as IntlString,
        kind: ClassifierKind.CLASS,
        extends: id === core.class.Obj ? undefined : id === core.class.Doc ? core.class.Obj : core.class.Doc,
        domain: DOMAIN_MODEL
      },
      id
    )
  )
  return txes.concat(factory.createTxCreateDoc(itemClass, core.space.Model, { count: 0 }, itemId))
}

// Jest's Node environment does not expose Web Crypto in every supported version.
beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
  }
})

describe('bundled model', () => {
  it('loads a complete WebSocket snapshot when no local model exists', async () => {
    const persistence = await createModelPersistence()
    expect(await persistence.load()).toMatchObject({ hash: '', systemTx: [], userTx: [] })
    const system = await createModelSnapshot(baseModel())
    const snapshot = { ...system, hash: system.hash + ':user' }
    const loadModel = jest.fn().mockResolvedValue(snapshot)
    const connection = { loadModel, close: jest.fn() } as unknown as ClientConnection
    const client = await createClient(async () => connection, undefined, persistence)

    expect(loadModel).toHaveBeenCalledWith(0, '')
    expect(await persistence.load()).toEqual(snapshot)
    expect(await client.getModel().findOne(itemClass, { _id: itemId })).toMatchObject({ count: 0 })
    await client.close()
  })

  it('uses the server base hash and isolates the supplied transactions', async () => {
    const base = baseModel()
    const snapshot = await createModelSnapshot(base)
    expect(snapshot.hash).toBe(createHash('sha1').update(JSON.stringify(base)).digest('hex'))
    expect(snapshot.systemTx).toEqual(JSON.parse(JSON.stringify(base)))
    expect(snapshot.systemTx[0]).not.toBe(base[0])
  })

  it.each(['user', 'full'])('loads the WebSocket model with kind=%s', async (kind) => {
    const base = baseModel()
    const json = JSON.stringify(base)
    const persistence = await createModelPersistence(base)
    const baseHash = (await persistence.load()).hash
    const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 1 } })
    const loadModel = jest.fn().mockResolvedValue({
      kind,
      hash: baseHash + ':workspace-hash',
      ...(kind === 'full' ? { systemTx: base } : {}),
      userTx: [delta]
    })
    const connection = { loadModel, close: jest.fn() } as unknown as ClientConnection
    const client = await createClient(async () => connection, undefined, persistence)

    expect(loadModel).toHaveBeenCalledWith(expect.any(Number), baseHash)
    expect(await client.getModel().findOne(itemClass, { _id: itemId })).toMatchObject({ count: 1 })
    expect(await persistence.load()).toMatchObject({
      hash: baseHash + ':workspace-hash',
      systemTx: JSON.parse(json),
      userTx: [delta]
    })
    expect(JSON.stringify(base)).toBe(json)
    await client.close()
  })

  it('reuses a persisted browser model with a matching version and skips rebuilds on reconnect', async () => {
    const base = baseModel()
    const system = await createModelSnapshot(base)
    const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 1 } })
    const persistence = await createModelPersistence()
    await persistence.store({
      ...system,
      hash: system.hash + ':user-hash',
      userTx: [delta]
    })
    const loadModel = jest.fn().mockRejectedValue(new Error('Unchanged models must not be downloaded'))
    const onConnect = jest.fn()
    const connection = {
      loadModel,
      getLastHash: async () => 'user-hash',
      onConnect,
      close: jest.fn()
    } as unknown as ClientConnection
    const client = await createClient(async () => connection, undefined, persistence)
    const model = client.getModel()
    const hierarchy = client.getHierarchy()

    expect(await model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 1 })
    await connection.onConnect?.(ClientConnectEvent.Reconnected, 'last-tx', {})
    expect(loadModel).not.toHaveBeenCalled()
    expect(client.getModel()).toBe(model)
    expect(client.getHierarchy()).toBe(hierarchy)
    expect(onConnect.mock.calls.map(([event]) => event)).not.toContain(ClientConnectEvent.Upgraded)
    await client.close()
  })

  it('reloads a changed browser model once and skips the next unchanged reconnect', async () => {
    const base = baseModel()
    const system = await createModelSnapshot(base)
    const persistence = await createModelPersistence(base)
    const oldDelta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 10 } })
    const removed = factory.createTxCreateDoc(itemClass, core.space.Model, { count: 5 })
    await persistence.store({ ...system, hash: system.hash + ':old-user', userTx: [oldDelta, removed] })
    let serverHash = 'old-user'
    const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 2 } })
    const loadModel = jest.fn().mockResolvedValue({ kind: 'user', hash: system.hash + ':new-user', userTx: [delta] })
    const connection = {
      loadModel,
      getLastHash: async () => serverHash,
      close: jest.fn()
    } as unknown as ClientConnection
    const client = await createClient(async () => connection, undefined, persistence)
    expect(await client.getModel().findOne(itemClass, { _id: itemId })).toMatchObject({ count: 10 })

    serverHash = 'new-user'
    await connection.onConnect?.(ClientConnectEvent.Reconnected, 'last-tx', {})
    const updatedModel = client.getModel()
    expect(await updatedModel.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 2 })
    expect(await updatedModel.findOne(itemClass, { _id: removed.objectId })).toBeUndefined()
    expect(loadModel).toHaveBeenCalledTimes(1)
    expect(loadModel.mock.calls[0][1]).toBe(system.hash + ':old-user')

    await connection.onConnect?.(ClientConnectEvent.Reconnected, 'last-tx', {})
    expect(loadModel).toHaveBeenCalledTimes(1)
    expect(client.getModel()).toBe(updatedModel)
    await client.close()
  })

  it.each(['system-only', 'unavailable'])(
    'loads the workspace model when the %s hash cannot confirm a complete match',
    async (reason) => {
      const system = await createModelSnapshot(baseModel())
      const persistence = await createModelPersistence(system.systemTx)
      if (reason === 'unavailable') {
        await persistence.store({ ...system, hash: system.hash + ':old-user' })
      }
      const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 1 } })
      const loadModel = jest.fn().mockResolvedValue({ kind: 'user', hash: system.hash + ':user', userTx: [delta] })
      const connection = {
        loadModel,
        getLastHash: async () => (reason === 'system-only' ? system.hash : undefined),
        close: jest.fn()
      } as unknown as ClientConnection
      const client = await createClient(async () => connection, undefined, persistence)
      expect(loadModel).toHaveBeenCalledTimes(1)
      expect(await client.getModel().findOne(itemClass, { _id: itemId })).toMatchObject({ count: 1 })
      await client.close()
    }
  )

  it.each([false, true])(
    'applies delta transactions once on reconnect, including already received=%s',
    async (alreadyReceived) => {
      const system = await createModelSnapshot(baseModel())
      const persistence = await createModelPersistence(system.systemTx)
      const oldDelta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 10 } })
      const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 1 } })
      const nextDelta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 2 } })
      await persistence.store({ ...system, hash: system.hash + ':old-user', userTx: [oldDelta] })
      const loadModel = jest
        .fn()
        .mockResolvedValueOnce({ kind: 'delta', hash: system.hash + ':new-user', transactions: [delta] })
        .mockResolvedValueOnce({ kind: 'delta', hash: system.hash + ':next-user', transactions: [nextDelta] })
        .mockResolvedValueOnce({ kind: 'delta', hash: system.hash + ':next-user', transactions: [] })
      const onConnect = jest.fn()
      const connection = { loadModel, onConnect, close: jest.fn() } as unknown as ClientConnection
      let receive: ((...transactions: Tx[]) => void) | undefined
      const client = await createClient(
        async (handler) => {
          receive = handler
          return connection
        },
        undefined,
        persistence
      )
      const model = client.getModel()
      const hierarchy = client.getHierarchy()
      expect(await model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 11 })

      if (alreadyReceived) {
        receive?.(nextDelta)
        expect(await model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 13 })
      }
      await connection.onConnect?.(ClientConnectEvent.Reconnected, 'last-tx', {})
      expect(client.getModel()).toBe(model)
      expect(client.getHierarchy()).toBe(hierarchy)
      expect(await model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 13 })
      await connection.onConnect?.(ClientConnectEvent.Reconnected, 'last-tx', {})
      expect(client.getModel()).toBe(model)
      expect(await model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 13 })
      expect(onConnect.mock.calls.map(([event]) => event)).not.toContain(ClientConnectEvent.Upgraded)
      expect(await persistence.load()).toEqual({
        ...system,
        hash: system.hash + ':next-user',
        userTx: [oldDelta, delta, nextDelta]
      })
      expect(loadModel.mock.calls.map((args) => args[1])).toEqual([
        system.hash + ':old-user',
        system.hash + ':new-user',
        system.hash + ':next-user'
      ])
      await client.close()
    }
  )

  it('recognizes persisted full snapshots by their kind', async () => {
    const snapshot = await createModelSnapshot(baseModel())
    expect(isFullModelResponse(snapshot)).toBe(true)
    expect(isFullModelResponse({ kind: 'user', hash: snapshot.hash, userTx: [] })).toBe(false)
    expect(isFullModelResponse({ kind: 'delta', hash: snapshot.hash, transactions: [] })).toBe(false)
  })

  it('rejects a user delta when the system part is unknown', () => {
    expect(() => mergeModelResponse(undefined, { kind: 'user', hash: 'system:user', userTx: [] })).toThrow(
      'A system model is required'
    )
  })

  it('refreshes the user model on reconnect using the latest instance hash', async () => {
    const base = baseModel()
    const json = JSON.stringify(base)
    const system = await createModelSnapshot(base)
    const persistence = await createModelPersistence(base)
    const oldDelta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 10 } })
    const removed = factory.createTxCreateDoc(itemClass, core.space.Model, { count: 5 })
    const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 1 } })
    const loadModel = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'user', hash: system.hash + ':old-user', userTx: [oldDelta, removed] })
      .mockResolvedValueOnce({ kind: 'user', hash: system.hash + ':new-user', userTx: [delta] })
      .mockResolvedValueOnce({ kind: 'user', hash: system.hash + ':empty-user', userTx: [] })
    const connection = { loadModel, close: jest.fn() } as unknown as ClientConnection
    const client = await createClient(async () => connection, undefined, persistence)

    expect(await client.getModel().findOne(itemClass, { _id: itemId })).toMatchObject({ count: 10 })
    expect(await client.getModel().findOne(itemClass, { _id: removed.objectId })).toBeDefined()
    await connection.onConnect?.(ClientConnectEvent.Reconnected, 'last-tx', {})
    expect(await client.getModel().findOne(itemClass, { _id: itemId })).toMatchObject({ count: 1 })
    expect(await client.getModel().findOne(itemClass, { _id: removed.objectId })).toBeUndefined()
    await connection.onConnect?.(ClientConnectEvent.Reconnected, 'last-tx', {})
    expect(await client.getModel().findOne(itemClass, { _id: itemId })).toMatchObject({ count: 0 })
    expect(loadModel.mock.calls.map((args) => args[1])).toEqual([
      system.hash,
      system.hash + ':old-user',
      system.hash + ':new-user'
    ])
    expect(getModelTransactions(await persistence.load())).toEqual(system.systemTx)
    expect(JSON.stringify(base)).toBe(json)
    await client.close()
  })
})

describe('REST model loading', () => {
  const originalFetch = globalThis.fetch
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()

  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  function respond (model: LoadModelResponse): void {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(model)))
  }

  it('merges incremental and empty deltas into the last complete REST model', async () => {
    const system = await createModelSnapshot(baseModel())
    const oldDelta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 10 } })
    const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 1 } })
    const client = createRestClient('http://localhost', 'workspace', 'token', { model: system.systemTx })
    respond({ kind: 'user', hash: system.hash + ':old-user', userTx: [oldDelta] })
    expect(await (await client.getModel()).model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 10 })
    respond({ kind: 'delta', hash: system.hash + ':new-user', transactions: [delta] })
    expect(await (await client.getModel()).model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 11 })
    respond({ kind: 'delta', hash: system.hash + ':new-user', transactions: [] })
    expect(await (await client.getModel()).model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 11 })
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('lastHash')).toBe(system.hash + ':old-user')
    expect(new URL(String(fetchMock.mock.calls[2][0])).searchParams.get('lastHash')).toBe(system.hash + ':new-user')
  })

  it('sends the base version and applies user transactions once on every load', async () => {
    const base = baseModel()
    const json = JSON.stringify(base)
    const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 1 } })
    respond({ kind: 'user', hash: 'system:workspace-hash', userTx: [delta] })
    const client = createRestClient('http://localhost', 'workspace', 'token', { model: base })

    for (let i = 0; i < 2; i++) {
      const { model } = await client.getModel()
      expect(await model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 1 })
    }
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get('lastHash')).toBe((await createModelSnapshot(base)).hash)
    expect(url.searchParams.get('full')).toBe('true')
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('lastHash')).toBe('system:workspace-hash')
    expect(JSON.stringify(base)).toBe(json)
  })

  it('replaces an outdated base with the full server model', async () => {
    const base = baseModel()
    const extra = factory.createTxCreateDoc(itemClass, core.space.Model, { count: 5 })
    const current = baseModel()
    respond({ kind: 'full', hash: 'current:new-hash', systemTx: current, userTx: [] })
    const client = createRestClient('http://localhost', 'workspace', 'token', { model: base.concat(extra) })

    const { model } = await client.getModel(true)
    expect(await model.findOne(itemClass, { _id: extra.objectId })).toBeUndefined()
    expect(await model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 0 })
    const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 2 } })
    respond({ kind: 'user', hash: 'current:next-hash', userTx: [delta] })
    const updated = await client.getModel()
    expect(await updated.model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 2 })
    expect(await updated.model.findOne(itemClass, { _id: extra.objectId })).toBeUndefined()
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('lastHash')).toBe('current:new-hash')
  })

  it('requests a complete versioned model without a local model', async () => {
    const system = await createModelSnapshot(baseModel())
    respond({ ...system, hash: system.hash + ':user' })
    const client = createRestClient('http://localhost', 'workspace', 'token')
    await client.getModel()
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get('lastHash')).toBe('')
    expect(url.searchParams.has('full')).toBe(false)
  })

  it('passes the base model through createRestTxOperations', async () => {
    const base = baseModel()
    const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 1 } })
    fetchMock.mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes('/account/')
              ? { socialIds: [core.account.System] }
              : { kind: 'user', hash: 'system:workspace-hash', userTx: [delta] }
          )
        )
    )

    const operations = await createRestTxOperations('http://localhost', 'workspace', 'token', false, { model: base })
    expect(await operations.getModel().findOne(itemClass, { _id: itemId })).toMatchObject({ count: 1 })
    const url = new URL(String(fetchMock.mock.calls[1][0]))
    expect(url.searchParams.get('lastHash')).toBe((await createModelSnapshot(base)).hash)
  })

  it('keeps a downloaded full model and replaces its user part on later loads', async () => {
    const system = await createModelSnapshot(baseModel())
    const oldDelta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 10 } })
    const removed = factory.createTxCreateDoc(itemClass, core.space.Model, { count: 5 })
    respond({ ...system, hash: system.hash + ':old-user', userTx: [oldDelta, removed] })
    const client = createRestClient('http://localhost', 'workspace', 'token')
    const initial = await client.getModel()
    expect(await initial.model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 10 })
    expect(await initial.model.findOne(itemClass, { _id: removed.objectId })).toBeDefined()
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('lastHash')).toBe('')

    const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 1 } })
    respond({ kind: 'user', hash: system.hash + ':new-user', userTx: [delta] })
    const updated = await client.getModel()
    expect(await updated.model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 1 })
    expect(await updated.model.findOne(itemClass, { _id: removed.objectId })).toBeUndefined()
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('lastHash')).toBe(system.hash + ':old-user')

    respond({ kind: 'user', hash: system.hash + ':empty-user', userTx: [] })
    const empty = await client.getModel()
    expect(await empty.model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 0 })
    expect(new URL(String(fetchMock.mock.calls[2][0])).searchParams.get('lastHash')).toBe(system.hash + ':new-user')
  })

  it('isolates model state between instances using the same system model', async () => {
    const base = baseModel()
    const json = JSON.stringify(base)
    const system = await createModelSnapshot(base)
    const privateDoc = factory.createTxCreateDoc(itemClass, core.space.Model, { count: 50 })
    respond({ kind: 'user', hash: system.hash + ':workspace-a', userTx: [privateDoc] })
    const first = createRestClient('http://localhost', 'workspace-a', 'token-a', { model: base })
    await first.getModel()

    const delta = factory.createTxUpdateDoc(itemClass, core.space.Model, itemId, { $inc: { count: 2 } })
    respond({ kind: 'user', hash: system.hash + ':workspace-b', userTx: [delta] })
    const second = createRestClient('http://localhost', 'workspace-b', 'token-b', { model: base })
    const { model } = await second.getModel()
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('lastHash')).toBe(system.hash)
    expect(await model.findOne(itemClass, { _id: privateDoc.objectId })).toBeUndefined()
    expect(await model.findOne(itemClass, { _id: itemId })).toMatchObject({ count: 2 })

    respond({ kind: 'user', hash: system.hash + ':workspace-a-next', userTx: [] })
    await first.getModel()
    expect(new URL(String(fetchMock.mock.calls[2][0])).searchParams.get('lastHash')).toBe(system.hash + ':workspace-a')
    expect(JSON.stringify(base)).toBe(json)
  })
})
