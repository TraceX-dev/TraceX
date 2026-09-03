//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-var-requires */

import card from '@hcengineering/card'
import calendar, { AccessLevel } from '@hcengineering/calendar'
import chunter from '@hcengineering/chunter'
import contact, { type Person } from '@hcengineering/contact'
import document from '@hcengineering/document'
import core, {
  ModelDb,
  TxOperations,
  type Class,
  type Client,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type FindResult,
  type Hierarchy,
  type PersonId,
  type Ref,
  type Tx
} from '@hcengineering/core'
import integration from '@hcengineering/integration'
import { setMetadata } from '@hcengineering/platform'
import time from '@hcengineering/time'

process.env.PORT = '8080'
process.env.ACCOUNTS_URL = 'http://accounts.test'
process.env.TRANSACTOR_URL = 'ws://transactor.test'
process.env.SERVER_SECRET = 'secret'
process.env.COLLABORATOR_URL = 'http://collaborator.test'

let mockCollaboratorContent = ''
const mockCollaborator = {
  createMarkup: jest.fn(async (_document: unknown, markup: string) => {
    mockCollaboratorContent = markup
    return 'mock-markup-blob'
  }),
  getMarkup: jest.fn(async () => mockCollaboratorContent),
  updateMarkup: jest.fn(async (_document: unknown, markup: string) => {
    mockCollaboratorContent = markup
  })
}

jest.mock('@hcengineering/account-client', () => ({
  getClient: jest.fn(() => ({ getLoginInfoByToken: jest.fn(async () => ({ socialId: 'person-1' })) })),
  isNetworkError: jest.fn(() => false)
}))
jest.mock('@hcengineering/server-client', () => ({ createClient: jest.fn() }))
jest.mock('@hcengineering/collaborator-client', () => ({ getClient: jest.fn(() => mockCollaborator) }))
jest.mock('@hcengineering/server-token', () => {
  class TokenError extends Error {}
  return {
    __esModule: true,
    default: { metadata: { Secret: 'server-token:metadata:Secret' } },
    decodeToken: jest.fn(() => ({ workspace: 'workspace-1' })),
    TokenError
  }
})

interface RouteLayer {
  route?: {
    path: string
    methods: Record<string, boolean>
    stack: Array<{ handle: (req: unknown, res: unknown) => void }>
  }
}

interface ApiResponse {
  status: number
  body: unknown
}

interface ModelBuilder {
  hierarchy: Hierarchy
  getTxes: () => Tx[]
}

const buildModel = require('../../../../models/all/src').default as () => ModelBuilder
const { createClient } = require('@hcengineering/server-client') as { createClient: jest.Mock }
const { app } = require('../index') as { app: { _router?: { stack: RouteLayer[] } } }

describe('Workspace API routes with local plugin resources', () => {
  let modelDb: ModelDb
  let client: Client
  let hierarchy: ModelBuilder['hierarchy']
  let workspaceDb: ModelDb
  let domainRequests: Array<Record<string, unknown>>

  beforeAll(async () => {
    const model = buildModel()
    hierarchy = model.hierarchy
    modelDb = new ModelDb(hierarchy)
    for (const tx of model.getTxes()) await modelDb.tx(tx)
  })

  beforeEach(async () => {
    setMetadata(contact.metadata.LastNameFirst, false)
    workspaceDb = new ModelDb(hierarchy)
    domainRequests = []
    mockCollaboratorContent = ''
    mockCollaborator.createMarkup.mockClear()
    mockCollaborator.getMarkup.mockClear()
    mockCollaborator.updateMarkup.mockClear()
    client = createInMemoryClient(modelDb, workspaceDb, hierarchy, domainRequests)
    createClient.mockResolvedValue(client)

    const operations = new TxOperations(client, 'person-1' as PersonId)
    for (const [id, name] of [
      [core.space.Space, 'Space'],
      [contact.space.Contacts, 'Contacts'],
      [calendar.space.Calendar, 'Calendar'],
      [time.space.ToDos, 'ToDos']
    ]) {
      await operations.createDoc(core.class.Space, core.space.Model, { name }, id as Ref<Doc>)
    }
    await operations.createDoc(card.class.CardSpace, core.space.Space, { name: 'Product' }, 'product-space' as Ref<Doc>)
    await operations.createDoc(
      document.class.Teamspace,
      core.space.Space,
      { name: 'Knowledge base' },
      'knowledge-base' as Ref<Doc>
    )
    await createEmployeeFixture(client)
    await operations.createDoc(
      calendar.class.Calendar,
      calendar.space.Calendar,
      {
        access: AccessLevel.Owner,
        hidden: false,
        name: 'Personal',
        user: 'person-1',
        visibility: 'private'
      },
      'personal-calendar' as Ref<Doc>
    )
  })

  it('uses the real card factory and resource against MemDB', async () => {
    expect(await api('get', '/api/v2/:workspaceId/cards')).toEqual({ status: 200, body: { documents: [], total: 0 } })

    const created = await api('post', '/api/v2/:workspaceId/cards', {
      body: { space: 'Product', fields: { content: '# API smoke card', title: 'API smoke card' } }
    })
    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({
      class: expect.any(String),
      space: 'Product',
      fields: expect.objectContaining({ content: expect.stringContaining('API smoke card'), title: 'API smoke card' })
    })

    const createdId = (created.body as { id: string }).id
    expect(
      await api('get', '/api/v2/:workspaceId/cards/:id', {
        query: { id: createdId }
      })
    ).toMatchObject({ status: 200, body: { id: createdId } })
    const patched = await api('patch', '/api/v2/:workspaceId/cards', {
      body: { id: createdId, fields: { title: 'Updated through API' } }
    })
    expect(patched.status).toBe(200)
    expect(patched.body).toMatchObject({
      id: createdId,
      fields: expect.objectContaining({ title: 'Updated through API' })
    })

    const afterPatch = await api('get', '/api/v2/:workspaceId/cards')
    expect(afterPatch).toMatchObject({
      status: 200,
      body: {
        total: 1,
        documents: [
          expect.objectContaining({ id: createdId, fields: expect.objectContaining({ title: 'Updated through API' }) })
        ]
      }
    })
  })

  it('discovers real spaces from the local workspace model', async () => {
    const response = await api('get', '/api/v2/:workspaceId/spaces', { query: { limit: '10' } })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      total: 6,
      spaces: expect.arrayContaining([expect.objectContaining({ name: 'Product', class: expect.any(String) })])
    })

    expect(await api('get', '/api/v2/:workspaceId/spaces', { query: { class: 'Document' } })).toEqual({
      status: 200,
      body: { spaces: [{ name: 'Knowledge base', class: 'Teamspace' }], total: 1 }
    })

    const schema = await api('get', '/api/v2/:workspaceId/schema')
    expect(schema.status).toBe(200)
    expect(
      (schema.body as { classes: Array<{ name: string, factory?: boolean, createIn?: string[] }> }).classes
    ).toContainEqual(expect.objectContaining({ name: 'Document', factory: true, createIn: ['Teamspace'] }))

    expect(
      await api('post', '/api/v2/:workspaceId/documents', {
        body: { space: 'Product', fields: { title: 'Wrong space' } }
      })
    ).toMatchObject({
      status: 400,
      body: { error: { code: 'validation_error', message: expect.stringContaining('Teamspace') } }
    })
  })

  it('serves a public Swagger page for the base API contract', async () => {
    expect(await api('get', '/api/v2/swagger')).toMatchObject({
      status: 200,
      body: expect.stringContaining("url: '/api/v2/openapi.json'")
    })
    expect(await api('get', '/api/v2/openapi.json')).toMatchObject({
      status: 200,
      body: {
        paths: expect.objectContaining({
          '/api/v2/{workspaceId}/documents': expect.objectContaining({
            get: expect.any(Object),
            post: expect.any(Object)
          }),
          '/api/v2/{workspaceId}/comments': expect.objectContaining({
            get: expect.any(Object),
            post: expect.any(Object)
          }),
          '/api/v2/{workspaceId}/calendar/events': expect.objectContaining({
            get: expect.any(Object),
            post: expect.any(Object)
          }),
          '/api/v2/{workspaceId}/todos': expect.objectContaining({ get: expect.any(Object), post: expect.any(Object) })
        })
      }
    })
  })

  it('uses the real document factory and validates plugin capability discovery', async () => {
    const created = await api('post', '/api/v2/:workspaceId/documents', {
      body: { space: 'Knowledge base', fields: { title: 'API guide' } }
    })
    expect(created).toMatchObject({ status: 200, body: { fields: { title: 'API guide' }, space: 'Knowledge base' } })
    const id = (created.body as { id: string }).id
    expect(
      await api('patch', '/api/v2/:workspaceId/documents', {
        body: { fields: { title: 'Updated API guide' }, id }
      })
    ).toMatchObject({ status: 200, body: { fields: { title: 'Updated API guide' } } })
    expect(await api('get', '/api/v2/:workspaceId/documents')).toMatchObject({
      status: 200,
      body: { documents: [expect.objectContaining({ id })], total: 1 }
    })
    expect(await api('get', '/api/v2/:workspaceId/todos', { query: { type: 'ProcessToDo' } })).toEqual({
      status: 200,
      body: []
    })
    expect(await api('get', '/api/v2/:workspaceId/controlled-documents')).toEqual({ status: 200, body: [] })
  })

  it('uses real contact, calendar, and ToDo resources', async () => {
    const contactCreated = await api('post', '/api/v2/:workspaceId/contacts', {
      body: { name: 'Alice Adams', type: 'Person' }
    })
    expect(contactCreated).toMatchObject({ status: 200, body: { fields: { name: 'Alice Adams' } } })
    const contactId = (contactCreated.body as { id: string }).id
    expect((workspaceDb.findObject(contactId as Ref<Doc>) as { name?: string } | undefined)?.name).toBe('Adams,Alice')
    expect(
      await api('patch', '/api/v2/:workspaceId/contacts', {
        body: { city: 'Almaty', id: contactId, type: 'Person' }
      })
    ).toMatchObject({ status: 200, body: { fields: { city: 'Almaty' } } })
    const contacts = await api('get', '/api/v2/:workspaceId/contacts', { query: { type: 'Person' } })
    expect(contacts.status).toBe(200)
    expect(contacts.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: contactId })]))

    const event = await api('post', '/api/v2/:workspaceId/calendar/events', {
      body: { calendar: 'Personal', date: 10, description: '**Planning details**', dueDate: 20, title: 'Planning' }
    })
    expect(event).toMatchObject({
      status: 200,
      body: { fields: { description: expect.stringContaining('Planning details'), title: 'Planning' } }
    })
    const eventId = (event.body as { id: string }).id
    expect(
      await api('patch', '/api/v2/:workspaceId/calendar/events', {
        body: { id: eventId, title: 'Updated planning' }
      })
    ).toMatchObject({ status: 200, body: { fields: { title: 'Updated planning' } } })
    const events = await api('get', '/api/v2/:workspaceId/calendar/events', { query: { calendar: 'Personal' } })
    expect(events.status).toBe(200)
    expect(events.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: eventId })]))

    const todo = await api('post', '/api/v2/:workspaceId/todos', { body: { title: 'Review API' } })
    expect(todo).toMatchObject({ status: 200, body: { fields: { title: 'Review API' } } })
    const todoId = (todo.body as { id: string }).id
    expect(
      await api('patch', '/api/v2/:workspaceId/todos', {
        body: { id: todoId, title: 'Review updated API' }
      })
    ).toMatchObject({ status: 200, body: { fields: { title: 'Review updated API' } } })
    const todos = await api('get', '/api/v2/:workspaceId/todos')
    expect(todos.status).toBe(200)
    expect(todos.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: todoId })]))
  })

  it('uses the configured contact name order', async () => {
    setMetadata(contact.metadata.LastNameFirst, true)
    const created = await api('post', '/api/v2/:workspaceId/contacts', {
      body: { name: 'Adams Alice', type: 'Person' }
    })
    expect(created).toMatchObject({ status: 200, body: { fields: { name: 'Adams Alice' } } })
    const id = (created.body as { id: string }).id
    expect((workspaceDb.findObject(id as Ref<Doc>) as { name?: string } | undefined)?.name).toBe('Adams,Alice')
  })

  it('uses workspace-selected comment and legacy chat resources', async () => {
    await new TxOperations(client, 'person-1' as PersonId).createDoc(
      chunter.class.Channel,
      core.space.Space,
      { archived: false, name: 'General' },
      'general-channel' as Ref<Doc>
    )
    const created = await api('post', '/api/v2/:workspaceId/cards', {
      body: { space: 'Product', fields: { title: 'Discussion' } }
    })
    const cardId = (created.body as { id: string }).id

    expect(
      await api('post', '/api/v2/:workspaceId/comments', {
        body: { content: 'First comment', target: { id: cardId } }
      })
    ).toMatchObject({ status: 200 })
    expect(await api('get', '/api/v2/:workspaceId/comments', { query: { id: cardId } })).toMatchObject({ status: 200 })
    expect(
      await api('post', '/api/v2/:workspaceId/chats/messages', {
        body: { channel: 'General', content: 'Hello team' }
      })
    ).toMatchObject({ status: 200 })
    expect(await api('get', '/api/v2/:workspaceId/chats/messages', { query: { channel: 'General' } })).toMatchObject({
      status: 200
    })
    expect(domainRequests).toHaveLength(0)
  })

  async function api (
    method: 'get' | 'post' | 'patch',
    path: string,
    options: { body?: Record<string, unknown>, query?: Record<string, string> } = {}
  ): Promise<ApiResponse> {
    const route = app._router?.stack.find((layer) => layer.route?.path === path && layer.route.methods[method])?.route
    if (route === undefined) throw new Error(`Route ${method.toUpperCase()} ${path} is not registered`)

    return await new Promise<ApiResponse>((resolve) => {
      let status = 200
      const res = {
        headersSent: false,
        status: (value: number) => {
          status = value
          return res
        },
        json: (body: unknown) => {
          resolve({ status, body })
        },
        type: () => res,
        send: (body: unknown) => {
          resolve({ status, body })
        }
      }
      route.stack.at(-1)?.handle(
        {
          body: options.body ?? {},
          header: (name: string) => (name.toLowerCase() === 'authorization' ? 'Bearer mock-api-key' : undefined),
          method: method.toUpperCase(),
          params: { workspaceId: 'workspace-1', ...(options.query?.id === undefined ? {} : { id: options.query.id }) },
          path,
          query: options.query ?? {}
        },
        res
      )
    })
  }
})

function createInMemoryClient (
  modelDb: ModelDb,
  workspaceDb: ModelDb,
  hierarchy: ModelBuilder['hierarchy'],
  domainRequests: Array<Record<string, unknown>>
): Client {
  const isModelResource = (value: Ref<Class<Doc>>): boolean =>
    value === integration.class.IntegrationTargetFactory || value === integration.class.WorkspaceApiCapability
  const findAll = async <T extends Doc>(
    value: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<FindResult<T>> => {
    return await (isModelResource(value as Ref<Class<Doc>>) ? modelDb : workspaceDb).findAll(value, query, options)
  }
  return {
    close: async () => {},
    domainRequest: async (_domain, params) => {
      domainRequests.push(params)
      return { domain: 'test' as never, value: [] }
    },
    findAll,
    findOne: async <T extends Doc>(value: Ref<Class<T>>, query: DocumentQuery<T>, options?: FindOptions<T>) => {
      return (await findAll(value, query, { ...options, limit: 1 }))[0]
    },
    getHierarchy: () => hierarchy,
    getModel: () => modelDb,
    searchFulltext: async () => ({ docs: [] }),
    tx: async (tx: Tx) => await workspaceDb.tx(tx)
  } as Client
}

async function createEmployeeFixture (client: Client): Promise<void> {
  const operations = new TxOperations(client, 'person-1' as PersonId)
  const employee = 'api-user' as Ref<Person>
  await operations.createDoc(
    contact.class.Person,
    contact.space.Contacts,
    { avatarType: 'color', name: 'API User' } as never,
    employee
  )
  await operations.createMixin(employee, contact.class.Person, contact.space.Contacts, contact.mixin.Employee, {
    active: true,
    avatarType: 'color',
    name: 'API User'
  } as never)
  await operations.addCollection(
    contact.class.SocialIdentity,
    contact.space.Contacts,
    employee,
    contact.class.Person,
    'socialIds',
    {} as never,
    'person-1' as never
  )
}
