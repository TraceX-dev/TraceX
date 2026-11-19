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

import card from '@hcengineering/card'
import core, {
  NoMetricsContext,
  SortingOrder,
  type AccountUuid,
  type ModelDb,
  type Ref,
  type TxOperations,
  type WorkspaceUuid
} from '@hcengineering/core'
import marketplace, {
  createDefinitionPackageRelease,
  serializeDefinitionPackageRelease,
  type CatalogPackage,
  type DefinitionPackageInstallation,
  type DefinitionPackageOwner
} from '@hcengineering/marketplace'
import process, { type Process } from '@hcengineering/process'
import type { Token } from '@hcengineering/server-token'
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import type { TraceXAuthInfo } from '../auth'
import { registerPackageAuthoringTools } from '../package-authoring'
import type { WorkspaceConnection, WorkspaceManager } from '../workspace'

const author = 'catalog-author' as AccountUuid
const source = `version: 2
kind: process
processes:
  review:
    label: Review
    slots:
      approval:
        kind: process
        class: process.Process
    resultType: number
    states:
      done: {}
`
const entry: CatalogPackage = {
  id: 'acme/review',
  author,
  owner: author,
  visibility: 'private',
  name: 'Review',
  description: 'Reusable review',
  kind: 'process',
  version: '1.0.0',
  authorName: 'Author',
  publishedOn: 1
}

interface ModelDocument {
  _id: string
  _class: string
  [key: string]: unknown
}

function fixture (
  url: string | undefined = 'https://catalog.test/api',
  allowed = true
): {
  call: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>
  getConnection: jest.Mock
  findAll: jest.Mock
  findOne: jest.Mock
  apply: jest.Mock
  modelDocuments: ModelDocument[]
} {
  const modelDocuments: ModelDocument[] = []
  const findObject: jest.Mock = jest.fn((id: string) => modelDocuments.find((doc) => doc._id === id))
  const findAllSync: jest.Mock = jest.fn((clazz: string, query: Record<string, unknown>) =>
    modelDocuments.filter(
      (doc) => doc._class === clazz && Object.entries(query).every(([key, value]) => doc[key] === value)
    )
  )
  const model: Partial<ModelDb> = { findObject, findAllSync }
  const findAll = jest.fn().mockResolvedValue([])
  const findOne = jest.fn().mockResolvedValue(undefined)
  const apply = jest.fn()
  const client: Partial<TxOperations> = { getModel: () => model as ModelDb, findAll, findOne, apply }
  const token: Token = { account: 'manager' as AccountUuid, workspace: 'workspace' as WorkspaceUuid }
  const connection: Partial<WorkspaceConnection> = { token, client: client as TxOperations }
  const getConnection = jest.fn().mockResolvedValue(connection)
  const manager: Partial<WorkspaceManager> = { getConnection }
  const auth: TraceXAuthInfo = {
    token: 'opaque',
    clientId: 'client',
    scopes: ['tracex'],
    resource: new URL('https://tracex.test/mcp'),
    extra: {
      account: token.account,
      accountToken: 'private-account-token',
      connectionId: 'connection',
      workspaceId: 'workspace'
    }
  }
  const register = jest.fn()
  const server: Partial<McpServer> = { registerTool: register }
  registerPackageAuthoringTools(
    server as McpServer,
    auth,
    manager as WorkspaceManager,
    async () => allowed,
    new NoMetricsContext(),
    url
  )
  return {
    getConnection,
    findAll,
    findOne,
    apply,
    modelDocuments,
    call: async (name, args = {}): Promise<CallToolResult> => {
      const invokeTool = register.mock.calls.find((call) => call[0] === name)?.[2] as (
        input: Record<string, unknown>
      ) => Promise<CallToolResult>
      return await invokeTool({ workspace: 'workspace', ...args })
    }
  }
}

async function release (version = '1.0.0', packageAuthor = author): Promise<string> {
  return serializeDefinitionPackageRelease(
    await createDefinitionPackageRelease({
      package: { id: entry.id, author: packageAuthor, version },
      source
    })
  )
}

async function installation (): Promise<DefinitionPackageInstallation> {
  return {
    _id: 'installation-a' as Ref<DefinitionPackageInstallation>,
    _class: marketplace.class.DefinitionPackageInstallation,
    space: core.space.Configuration,
    modifiedOn: 1,
    modifiedBy: core.account.System,
    name: 'Installed review',
    package: { id: entry.id, author, version: '1.0.0' },
    release: await release(),
    identities: { review: 'local-review', done: 'old-state' },
    destinations: {
      review: { masterTag: 'card-type' as Process['masterTag'], bindings: { approval: 'local-approval' } }
    }
  }
}

let fetchMock: jest.SpyInstance<ReturnType<typeof fetch>, Parameters<typeof fetch>>
beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network access'))
})
afterEach(() => {
  fetchMock.mockRestore()
})

describe('Marketplace discovery over MCP', () => {
  it.each(['package_search', 'package_releases', 'package_inspect', 'package_installed', 'package_inspect_installed'])(
    'checks authoring access before %s can access any service',
    async (name) => {
      const ws = fixture('https://catalog.test', false)
      expect(JSON.stringify(await ws.call(name))).toContain('package_authoring_forbidden')
      expect(ws.getConnection).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(ws.findAll).not.toHaveBeenCalled()
      expect(ws.findOne).not.toHaveBeenCalled()
    }
  )

  it('checks the OAuth workspace restriction before reading the installation-wide catalog', async () => {
    const ws = fixture()
    ws.getConnection.mockRejectedValue(new Error('Workspace not authorized'))
    expect((await ws.call('package_search', { workspace: 'other-workspace' })).isError).toBe(true)
    expect(ws.getConnection).toHaveBeenCalledWith('private-account-token', 'other-workspace', 'workspace')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('searches with the human account token and preserves catalog pagination without writes', async () => {
    const ws = fixture()
    fetchMock.mockResolvedValue(Response.json({ items: [entry], nextOffset: 10 }))
    const result = await ws.call('package_search', { search: 'review', mine: true, limit: 10 })
    expect(result.structuredContent).toMatchObject({ items: [entry], nextOffset: 10 })
    const [url, request] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://catalog.test/api/packages?search=review&mine=true&limit=10')
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer private-account-token')
    expect(request?.method).toBeUndefined()
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('keeps MCP attachment limits authoritative when catalog data claims installation support', async () => {
    const ws = fixture()
    fetchMock.mockResolvedValue(
      Response.json({
        items: [entry],
        capabilities: {
          installPackages: true,
          attachProcessesToCardTypes: true,
          declareExternalPackageDependencies: true
        }
      })
    )
    const result = await ws.call('package_search', { search: 'review' })
    expect(result.structuredContent).toMatchObject({
      items: [entry],
      capabilities: {
        installPackages: false,
        attachProcessesToCardTypes: false,
        declareExternalPackageDependencies: true
      },
      instructions: expect.stringContaining('Do not copy, rewrite or embed the returned graph as a substitute')
    })
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('lists releases using both the original author and package identity', async () => {
    const ws = fixture()
    fetchMock.mockResolvedValue(Response.json({ items: [], nextOffset: 30 }))
    expect((await ws.call('package_releases', { id: entry.id, author, offset: 0 })).structuredContent).toMatchObject({
      nextOffset: 30
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/releases?id=acme%2Freview&author=catalog-author&offset=0')
  })

  it.each([undefined, '0.9.0'])(
    'downloads and verifies the selected version %s and exposes reusable process contracts',
    async (version) => {
      const ws = fixture()
      const selected = version ?? entry.version
      fetchMock.mockResolvedValueOnce(Response.json(entry)).mockResolvedValueOnce(new Response(await release(selected)))
      const result = await ws.call('package_inspect', {
        id: entry.id,
        author,
        ...(version === undefined ? {} : { version })
      })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toMatchObject({
        package: { id: entry.id, author, version: selected },
        latestVersion: '1.0.0',
        source: expect.stringContaining('processes:'),
        capabilities: { attachProcessesToCardTypes: false, declareExternalPackageDependencies: true },
        instructions: expect.stringContaining('this does not attach the child to another card type'),
        processes: [
          expect.objectContaining({
            member: 'review',
            requiredSlots: { approval: expect.objectContaining({ slotKind: 'process' }) },
            resultType: expect.objectContaining({ _class: core.class.TypeNumber })
          })
        ]
      })
      expect(String(fetchMock.mock.calls[1][0])).toContain(`version=${selected}`)
      expect(ws.apply).not.toHaveBeenCalled()
    }
  )

  it('rejects a valid release downloaded for a different author', async () => {
    const ws = fixture()
    fetchMock
      .mockResolvedValueOnce(Response.json(entry))
      .mockResolvedValueOnce(new Response(await release('1.0.0', 'different-author' as AccountUuid)))
    expect(JSON.stringify(await ws.call('package_inspect', { id: entry.id, author }))).toContain(
      'package_identity_mismatch'
    )
  })

  it('rejects tampered release contents', async () => {
    const ws = fixture()
    fetchMock
      .mockResolvedValueOnce(Response.json(entry))
      .mockResolvedValueOnce(new Response((await release()).replace('label: Review', 'label: Tampered')))
    expect(JSON.stringify(await ws.call('package_inspect', { id: entry.id, author }))).toContain('invalid_definition')
  })

  it('does not expose existence or server details for private or missing packages', async () => {
    const ws = fixture()
    fetchMock.mockResolvedValue(Response.json({ message: 'Sensitive private package name' }, { status: 404 }))
    const result = await ws.call('package_inspect', { id: entry.id, author })
    expect(JSON.stringify(result)).toContain('marketplace_package_not_found')
    expect(JSON.stringify(result)).not.toContain('Sensitive private package name')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports missing catalog configuration while keeping installed discovery available', async () => {
    const ws = fixture('')
    expect(JSON.stringify(await ws.call('package_search'))).toContain('marketplace_not_configured')
    expect((await ws.call('package_installed')).structuredContent).toMatchObject({ items: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('installed package reuse', () => {
  it('keeps repeated installations separate and uses bounded cursor pagination', async () => {
    const ws = fixture()
    const first = await installation()
    const second: DefinitionPackageInstallation = {
      ...first,
      _id: 'installation-b' as Ref<DefinitionPackageInstallation>
    }
    ws.findAll.mockResolvedValue([first, second])
    expect((await ws.call('package_installed', { id: entry.id, author, limit: 1 })).structuredContent).toMatchObject({
      items: [{ installationId: first._id, package: first.package }],
      nextCursor: first._id,
      capabilities: { installPackages: false, attachProcessesToCardTypes: false },
      instructions: expect.stringContaining('MCP saves drafts without installing')
    })
    expect(ws.findAll).toHaveBeenCalledWith(
      marketplace.class.DefinitionPackageInstallation,
      { 'package.id': entry.id, 'package.author': author },
      { sort: { _id: SortingOrder.Ascending }, limit: 2, projection: { _id: 1, name: 1, package: 1 } }
    )
    await ws.call('package_installed', { after: first._id, limit: 1 })
    expect(ws.findAll).toHaveBeenLastCalledWith(
      marketplace.class.DefinitionPackageInstallation,
      { _id: { $gt: first._id } },
      { sort: { _id: SortingOrder.Ascending }, limit: 2, projection: { _id: 1, name: 1, package: 1 } }
    )
  })

  it('returns current local process IDs and edited graphs rather than treating the baseline as current', async () => {
    const ws = fixture()
    const installed = await installation()
    ws.findOne.mockResolvedValue(installed)
    const current: Process & DefinitionPackageOwner = {
      _id: 'local-review' as Ref<Process>,
      _class: process.class.Process,
      space: core.space.Model,
      modifiedOn: 2,
      modifiedBy: core.account.System,
      name: 'Locally customized review',
      description: '',
      rank: 'a',
      masterTag: 'card-type' as Process['masterTag'],
      context: {},
      definitionPackageInstallation: { id: installed._id, member: 'review' }
    }
    ws.modelDocuments.push(
      { ...current },
      {
        _id: 'new-state',
        _class: process.class.State,
        process: current._id,
        title: 'Local addition',
        rank: 'a'
      }
    )
    const result = await ws.call('package_inspect_installed', { installationId: installed._id })
    expect(result.structuredContent).toMatchObject({
      processes: [
        {
          member: 'review',
          processId: current._id,
          available: true,
          definition: { name: 'Locally customized review' },
          states: [{ _id: 'new-state', title: 'Local addition' }],
          baselineRequiredSlots: { approval: expect.objectContaining({ slotKind: 'process' }) },
          savedDestination: { bindings: { approval: 'local-approval' } }
        }
      ]
    })
    expect(ws.apply).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks missing or disconnected local members unavailable', async () => {
    const ws = fixture()
    const installed = await installation()
    ws.findOne.mockResolvedValue(installed)
    ws.modelDocuments.push({ _id: 'local-review', _class: process.class.Process, masterTag: 'card-type' })
    expect(
      (await ws.call('package_inspect_installed', { installationId: installed._id })).structuredContent
    ).toMatchObject({
      processes: [{ member: 'review', processId: 'local-review', available: false }]
    })
  })

  it('recognizes embedded processes through their installed card owner', async () => {
    const ws = fixture()
    const installed = await installation()
    const module = `version: 2
kind: card
cardTypes:
  purchase:
    label: Purchase
    extends: card:class:Card
    kind: 0
processes:
  review:
    label: Review
    masterTag: purchase
    states:
      done: {}
`
    installed.release = serializeDefinitionPackageRelease(
      await createDefinitionPackageRelease({ package: installed.package, source: module })
    )
    installed.identities.purchase = 'local-purchase'
    installed.destinations = {}
    ws.findOne.mockResolvedValue(installed)
    ws.modelDocuments.push(
      {
        _id: 'local-purchase',
        _class: card.class.MasterTag,
        definitionPackageInstallation: { id: installed._id, member: 'purchase' }
      },
      { _id: 'local-review', _class: process.class.Process, masterTag: 'local-purchase' }
    )
    expect(
      (await ws.call('package_inspect_installed', { installationId: installed._id })).structuredContent
    ).toMatchObject({
      processes: [{ member: 'review', processId: 'local-review', available: true, savedDestination: null }]
    })
  })

  it('rejects an installation whose recorded package metadata no longer matches its baseline', async () => {
    const ws = fixture()
    const installed = await installation()
    installed.package = { ...installed.package, version: '2.0.0' }
    ws.findOne.mockResolvedValue(installed)
    expect(JSON.stringify(await ws.call('package_inspect_installed', { installationId: installed._id }))).toContain(
      'package_identity_mismatch'
    )
  })

  it('does not reveal another workspace installation when it cannot be read', async () => {
    const ws = fixture()
    expect(
      JSON.stringify(await ws.call('package_inspect_installed', { installationId: 'hidden-installation' }))
    ).toContain('package_installation_not_found')
    expect(ws.findOne).toHaveBeenCalledWith(marketplace.class.DefinitionPackageInstallation, {
      _id: 'hidden-installation'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
