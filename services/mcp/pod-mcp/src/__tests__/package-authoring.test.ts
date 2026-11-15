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

import contact from '@hcengineering/contact'
import core, {
  NoMetricsContext,
  type AccountUuid,
  type Hierarchy,
  type ModelDb,
  type Ref,
  type Space,
  type TxOperations,
  type WorkspaceUuid
} from '@hcengineering/core'
import marketplace, {
  createDefinitionPackageRelease,
  parseDefinitionPackageRelease,
  serializeDefinitionPackageRelease,
  type CatalogPackage,
  type DefinitionPackageDraft,
  type DefinitionPackageRelease
} from '@hcengineering/marketplace'
import type { Token } from '@hcengineering/server-token'
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import type { TraceXAuthInfo } from '../auth'
import { registerPackageAuthoringTools } from '../package-authoring'
import { createPackageAuthorizer, type PackageAuthorizer } from '../package-authoring-access'
import { readPackageAuthoringGuide } from '../package-authoring-guide'
import type { WorkspaceConnection, WorkspaceManager } from '../workspace'

const author = 'author-account' as AccountUuid
const source = `version: 2
kind: process
processes:
  review:
    label: Review
    start:
      begin:
        to: done
        on: OnExecutionStart
        actions:
          request:
            method: RequestApproval
            as: approval
    states:
      done: {}
`

interface FixtureDocument {
  _id: string
  _class: string
  createdContext?: { _class: string }
  requiredParams?: string[]
}

function fixture (
  authors: string[] = [author],
  authorize?: PackageAuthorizer,
  marketplaceUrl?: string
): {
  call: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>
  getConnection: jest.Mock
  createDoc: jest.Mock
  updateDoc: jest.Mock
  findOne: jest.Mock
  apply: jest.Mock
  match: jest.Mock
  commit: jest.Mock
  operations: FixtureDocument[]
  context: NoMetricsContext
} {
  const operations: FixtureDocument[] = [
    { _id: 'process:trigger:OnExecutionStart', _class: 'process:class:Trigger', requiredParams: [] },
    {
      _id: 'process:method:RequestApproval',
      _class: 'process:class:Method',
      createdContext: { _class: 'process:class:ApproveRequest' },
      requiredParams: []
    }
  ]
  const findObject: jest.Mock = jest.fn((id: string) => operations.find((doc) => doc._id === id))
  const findAllSync: jest.Mock = jest.fn((clazz: string) => operations.filter((doc) => doc._class === clazz))
  const model: Partial<ModelDb> = {
    findObject,
    findAllSync
  }
  const hierarchy: Partial<Hierarchy> = { isDerived: jest.fn((actual, expected) => actual === expected) }
  const createDoc = jest.fn().mockResolvedValue(undefined)
  const updateDoc = jest.fn().mockResolvedValue(undefined)
  const match = jest.fn()
  const commit = jest.fn().mockResolvedValue({ result: true })
  const apply: jest.Mock = jest.fn(() => ({ createDoc, updateDoc, commit, match, notMatch: jest.fn() }))
  const findOne: jest.Mock = jest.fn(async (clazz: string) => {
    if (clazz === contact.class.Person) return { _id: 'person' }
    if (clazz === contact.class.PersonSpace) return { _id: 'private-space', private: true, members: [author] }
    return undefined
  })
  const client: Partial<TxOperations> = {
    getModel: () => model as ModelDb,
    getHierarchy: () => hierarchy as Hierarchy,
    findOne,
    apply
  }
  const token: Token = { account: author, workspace: 'workspace' as WorkspaceUuid }
  const connection: Partial<WorkspaceConnection> = { client: client as TxOperations, token }
  const getConnection = jest.fn().mockResolvedValue(connection)
  const manager: Partial<WorkspaceManager> = { getConnection }
  const auth: TraceXAuthInfo = {
    token: 'opaque',
    clientId: 'client',
    scopes: ['tracex'],
    resource: new URL('https://tracex.test/mcp'),
    extra: { account: author, accountToken: 'private-token', connectionId: 'connection', workspaceId: 'workspace' }
  }
  const register = jest.fn()
  const server: Partial<McpServer> = { registerTool: register }
  const context = new NoMetricsContext()
  registerPackageAuthoringTools(
    server as McpServer,
    auth,
    manager as WorkspaceManager,
    authorize ?? createPackageAuthorizer({ AccountsURL: 'https://accounts.test', PackageAuthorAccounts: authors }),
    context,
    marketplaceUrl
  )
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> => {
    const invokeTool = register.mock.calls.find((call) => call[0] === name)?.[2] as (
      input: Record<string, unknown>
    ) => Promise<CallToolResult>
    return await invokeTool({ workspace: 'workspace', ...args })
  }
  return { call, getConnection, createDoc, updateDoc, findOne, apply, match, commit, operations, context }
}

function input (): Record<string, unknown> {
  return {
    source,
    name: 'Purchase review',
    description: 'A review package',
    review: 'Fields, graph, bindings and manual scenarios.'
  }
}

function draft (release: string): DefinitionPackageDraft {
  return {
    _id: 'draft' as Ref<DefinitionPackageDraft>,
    _class: marketplace.class.DefinitionPackageDraft,
    space: 'private-space' as Ref<Space>,
    modifiedBy: core.account.System,
    modifiedOn: 10,
    author,
    name: 'Review',
    review: 'Explanation',
    release,
    revision: 1
  }
}

describe('MCP package authoring', () => {
  it('measures a package call with its public tool ID and executes it once', async () => {
    const workspace = fixture()
    const measure = jest.spyOn(workspace.context, 'with')
    const result = await workspace.call('package_contracts')
    expect(result.isError).not.toBe(true)
    expect(measure).toHaveBeenCalledWith('mcp-tool', { tool: 'package_contracts' }, expect.any(Function))
    expect(measure).toHaveBeenCalledTimes(1)
    expect(workspace.getConnection).toHaveBeenCalledTimes(1)
  })

  it('denies access before workspace lookup when email verification is unavailable without exposing details', async () => {
    const authorize: PackageAuthorizer = jest.fn().mockRejectedValue(new Error('private account-service details'))
    const ws = fixture([], authorize)
    const result = await ws.call('package_contracts')
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('package_authoring_unavailable')
    expect(JSON.stringify(result)).not.toContain('private account-service details')
    expect(ws.getConnection).not.toHaveBeenCalled()
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it.each([
    'package_authoring_guide',
    'package_contracts',
    'package_validate',
    'package_get_draft',
    'package_save_draft',
    'package_create_version_draft'
  ])('denies %s before any workspace lookup when the account is not enabled', async (name) => {
    const ws = fixture([])
    const result = await ws.call(name, input())
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('package_authoring_forbidden') })
    ])
    expect(ws.getConnection).not.toHaveBeenCalled()
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('propagates OAuth workspace restrictions on every call and does not disclose internal errors', async () => {
    const ws = fixture()
    ws.getConnection.mockRejectedValue(new Error('private database credentials'))
    const result = await ws.call('package_contracts', { workspace: 'another-workspace' })
    expect(ws.getConnection).toHaveBeenCalledWith('private-token', 'another-workspace', 'workspace')
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('private database credentials')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('returns the installed operation catalog and normalizes inferred outputs for offline release parsing', async () => {
    const ws = fixture()
    const catalog = await ws.call('package_contracts')
    expect(catalog.structuredContent).toMatchObject({
      catalog: {
        methods: { 'process:method:RequestApproval': { createdContext: { _class: 'process:class:ApproveRequest' } } }
      }
    })
    const result = await ws.call('package_validate', { source })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      valid: true,
      installationReviewRequired: true,
      source: expect.stringContaining('class: process.ApproveRequest')
    })
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('rejects unknown installed operations with authored diagnostics before writing a draft', async () => {
    const ws = fixture()
    const result = await ws.call('package_save_draft', {
      ...input(),
      source: source.replace('RequestApproval', 'InventedMethod')
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('invalid_definition')
    expect(JSON.stringify(result)).toContain('InventedMethod')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('saves exactly one private draft with authenticated authorship and a verifiable release', async () => {
    const ws = fixture()
    const result = await ws.call('package_save_draft', input())
    expect(result.isError).not.toBe(true)
    expect(ws.createDoc).toHaveBeenCalledTimes(1)
    const [clazz, space, data] = ws.createDoc.mock.calls[0]
    expect(clazz).toBe(marketplace.class.DefinitionPackageDraft)
    expect(space).toBe('private-space')
    expect(data).toMatchObject({ author, revision: 1, name: 'Purchase review' })
    const release = await parseDefinitionPackageRelease(data.release)
    expect(release.package).toMatchObject({ author, version: '1.0.0' })
    expect(ws.updateDoc).not.toHaveBeenCalled()
    expect(ws.commit).toHaveBeenCalledTimes(1)
  })

  it('does not fall back to a public space when private storage is unavailable', async () => {
    const ws = fixture()
    ws.findOne.mockResolvedValue(undefined)
    const result = await ws.call('package_save_draft', input())
    expect(JSON.stringify(result)).toContain('private_space_required')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('filters draft reads by the authenticated author', async () => {
    const ws = fixture()
    const result = await ws.call('package_get_draft', { draftId: 'someone-elses-draft' })
    expect(ws.findOne).toHaveBeenCalledWith(marketplace.class.DefinitionPackageDraft, {
      _id: 'someone-elses-draft',
      author
    })
    expect(JSON.stringify(result)).toContain('draft_not_found')
  })

  it('retains package identity and uses an optimistic revision condition when editing a draft', async () => {
    const ws = fixture()
    await ws.call('package_save_draft', input())
    const current = draft(ws.createDoc.mock.calls[0][2].release)
    const original = await parseDefinitionPackageRelease(current.release)
    ws.findOne.mockImplementation(async (clazz: string) => {
      if (clazz === marketplace.class.DefinitionPackageDraft) return current
      if (clazz === contact.class.Person) return { _id: 'person' }
      return { _id: 'private-space', private: true, members: [author] }
    })
    ws.createDoc.mockClear()
    const result = await ws.call('package_save_draft', { ...input(), draftId: current._id, expectedRevision: 1 })
    expect(result.structuredContent).toMatchObject({ revision: 2, package: { id: original.package.id, author } })
    expect(ws.match).toHaveBeenCalledWith(current._class, { _id: current._id, author, revision: 1, modifiedOn: 10 })
    expect(ws.createDoc).not.toHaveBeenCalled()
    expect(ws.updateDoc).toHaveBeenCalledWith(
      current._class,
      current.space,
      current._id,
      expect.objectContaining({ revision: 2 })
    )
    expect(ws.updateDoc.mock.calls[0][3]).not.toHaveProperty('author')
    ws.apply.mockClear()
    expect(
      JSON.stringify(await ws.call('package_save_draft', { ...input(), draftId: current._id, expectedRevision: 2 }))
    ).toContain('draft_conflict')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('reports a failed conditional commit instead of acknowledging a saved draft', async () => {
    const ws = fixture()
    ws.commit.mockResolvedValue({ result: false })
    expect(JSON.stringify(await ws.call('package_save_draft', input()))).toContain('draft_conflict')
  })
})

describe('package authoring documentation', () => {
  it('serves canonical guide sections, schema and examples without arbitrary file access', async () => {
    expect(await readPackageAuthoringGuide()).toMatchObject({
      sections: expect.arrayContaining(['Validation boundaries', 'YAML contract']),
      content: expect.stringContaining('Start here')
    })
    expect(await readPackageAuthoringGuide('Validation boundaries')).toMatchObject({
      content: expect.stringContaining('does **not** universally declare')
    })
    expect(await readPackageAuthoringGuide('schema')).toMatchObject({ content: expect.stringContaining('"$schema"') })
    expect(await readPackageAuthoringGuide('example:approval.process.yaml')).toMatchObject({
      content: expect.stringContaining('kind: process')
    })
    await expect(readPackageAuthoringGuide('example:../../../../../etc/passwd')).rejects.toThrow(
      'Unknown guide section'
    )
  })
})

describe('default design guidance through the registered MCP tool', () => {
  it('discovers the preferences and downloads a complete reactive risk module without writes', async () => {
    const ws = fixture()
    const start = await ws.call('package_authoring_guide')
    expect(start.isError).not.toBe(true)
    expect(start.structuredContent).toMatchObject({
      sections: expect.arrayContaining([
        'Design preferences',
        'Reactive calculations through fields',
        'Value is set',
        'Worked risk management example'
      ]),
      examples: expect.arrayContaining(['example:risk-management-reactive.card.yaml']),
      instructions: expect.stringContaining('Read Design preferences first')
    })
    for (const section of ['Design preferences', 'Value is set', 'Worked risk management example']) {
      const response = await ws.call('package_authoring_guide', { section })
      expect(response.isError).not.toBe(true)
      expect(response.structuredContent).toMatchObject({ section, content: expect.any(String) })
    }
    const example = await ws.call('package_authoring_guide', { section: 'example:risk-management-reactive.card.yaml' })
    expect(example.isError).not.toBe(true)
    expect(example.structuredContent).toMatchObject({
      content: expect.stringContaining('normalize_risk:')
    })
    expect(ws.getConnection).toHaveBeenCalledWith('private-token', 'workspace', 'workspace')
    expect(ws.apply).not.toHaveBeenCalled()
  })
})

describe('MCP package version drafts', () => {
  let fetchMock: jest.SpyInstance<ReturnType<typeof fetch>, Parameters<typeof fetch>>

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected catalog access'))
  })
  afterEach(() => {
    fetchMock.mockRestore()
  })

  async function baseDraft (ws: ReturnType<typeof fixture>): Promise<{
    current: DefinitionPackageDraft
    release: DefinitionPackageRelease
  }> {
    const result = await ws.call('package_save_draft', input())
    if (result.isError === true) throw new Error('Failed to create the base fixture')
    const current = draft(ws.createDoc.mock.calls[0][2].release)
    const release = await parseDefinitionPackageRelease(current.release)
    ws.findOne.mockImplementation(async (clazz: string, query: Record<string, unknown>) => {
      if (clazz === marketplace.class.DefinitionPackageDraft) {
        return query._id === current._id && query.author === author ? current : undefined
      }
      if (clazz === contact.class.Person) return { _id: 'person' }
      if (clazz === contact.class.PersonSpace) return { _id: 'private-space', private: true, members: [author] }
      return undefined
    })
    for (const mock of [ws.createDoc, ws.updateDoc, ws.apply, ws.match, ws.commit]) mock.mockClear()
    return { current, release }
  }

  function catalog (release: DefinitionPackageRelease, body: string, latestVersion = release.package.version): void {
    const entry: CatalogPackage = {
      id: release.package.id,
      author,
      owner: author,
      visibility: 'private',
      name: 'Review',
      description: 'Review package',
      kind: release.definition.kind,
      version: latestVersion,
      authorName: 'Author',
      publishedOn: 1
    }
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(entry), { status: 200 }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
  }

  function catalogBase (release: DefinitionPackageRelease): Record<string, unknown> {
    return {
      id: release.package.id,
      author,
      version: release.package.version,
      contentHash: release.contentHash
    }
  }

  it('creates a separate next-version private draft from an owned draft without catalog access', async () => {
    const ws = fixture()
    const { current, release } = await baseDraft(ws)
    const original = current.release
    const result = await ws.call('package_create_version_draft', {
      ...input(),
      source: source.replace('label: Review', 'label: Updated review'),
      base: { draftId: current._id, expectedRevision: current.revision }
    })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      revision: 1,
      package: { id: release.package.id, author, version: '1.0.1' },
      basedOn: { draftId: current._id, revision: 1, package: release.package, contentHash: release.contentHash }
    })
    expect(ws.createDoc).toHaveBeenCalledTimes(1)
    const [clazz, space, data, newId] = ws.createDoc.mock.calls[0]
    expect(clazz).toBe(marketplace.class.DefinitionPackageDraft)
    expect(space).toBe('private-space')
    expect(newId).not.toBe(current._id)
    expect(data).toMatchObject({ author, revision: 1 })
    const next = await parseDefinitionPackageRelease(data.release)
    expect(next.package).toMatchObject({ id: release.package.id, author, version: '1.0.1' })
    expect(next.contentHash).not.toBe(release.contentHash)
    expect(next.source).toContain('label: Updated review')
    expect(next.definition.docs.find((doc) => doc._class === 'process:class:Process')?._id).toBe('review')
    expect(ws.match).toHaveBeenCalledWith(current._class, {
      _id: current._id,
      author,
      revision: current.revision,
      modifiedOn: current.modifiedOn
    })
    expect(current.release).toBe(original)
    expect(ws.updateDoc).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('subsequently edits the new draft revision without allocating another release version', async () => {
    const ws = fixture()
    const { current, release } = await baseDraft(ws)
    await ws.call('package_create_version_draft', {
      ...input(),
      base: { draftId: current._id, expectedRevision: 1 }
    })
    const [, , data, id] = ws.createDoc.mock.calls[0]
    const next: DefinitionPackageDraft = { ...draft(data.release), _id: id }
    ws.findOne.mockImplementation(async (clazz: string) => {
      if (clazz === marketplace.class.DefinitionPackageDraft) return next
      if (clazz === contact.class.Person) return { _id: 'person' }
      return { _id: 'private-space', private: true, members: [author] }
    })
    ws.createDoc.mockClear()
    const result = await ws.call('package_save_draft', { ...input(), draftId: next._id, expectedRevision: 1 })
    expect(result.structuredContent).toMatchObject({
      draftId: next._id,
      revision: 2,
      package: { id: release.package.id, author, version: '1.0.1' }
    })
    expect(ws.createDoc).not.toHaveBeenCalled()
    expect(ws.updateDoc).toHaveBeenCalledTimes(1)
    ws.apply.mockClear()
    const changedKind = await ws.call('package_save_draft', {
      ...input(),
      draftId: next._id,
      expectedRevision: 1,
      source:
        'version: 2\nkind: card\ncardTypes:\n  different_kind:\n    label: Card\n    extends: card:class:Card\n    kind: 0\n'
    })
    expect(JSON.stringify(changedKind)).toContain('package_kind_mismatch')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('rejects a stale base draft before creating a version', async () => {
    const ws = fixture()
    const { current } = await baseDraft(ws)
    const result = await ws.call('package_create_version_draft', {
      ...input(),
      base: { draftId: current._id, expectedRevision: 2 }
    })
    expect(JSON.stringify(result)).toContain('draft_conflict')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('detects a base draft edit racing the new-draft commit', async () => {
    const ws = fixture()
    const { current } = await baseDraft(ws)
    ws.commit.mockResolvedValue({ result: false })
    const result = await ws.call('package_create_version_draft', {
      ...input(),
      base: { draftId: current._id, expectedRevision: 1 }
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('draft_conflict')
    expect(ws.match).toHaveBeenCalledWith(current._class, expect.objectContaining({ revision: 1, modifiedOn: 10 }))
    expect(ws.updateDoc).not.toHaveBeenCalled()
  })

  it("does not disclose or copy another author's draft", async () => {
    const ws = fixture()
    const result = await ws.call('package_create_version_draft', {
      ...input(),
      base: { draftId: 'foreign-draft', expectedRevision: 1 }
    })
    expect(JSON.stringify(result)).toContain('draft_not_found')
    expect(ws.findOne).toHaveBeenCalledWith(marketplace.class.DefinitionPackageDraft, { _id: 'foreign-draft', author })
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('rejects a tampered draft with a different original package author', async () => {
    const ws = fixture()
    const { current, release } = await baseDraft(ws)
    current.release = serializeDefinitionPackageRelease(
      await createDefinitionPackageRelease({
        package: { ...release.package, author: 'another-author' as AccountUuid },
        source: release.source
      })
    )
    const result = await ws.call('package_create_version_draft', {
      ...input(),
      base: { draftId: current._id, expectedRevision: 1 }
    })
    expect(JSON.stringify(result)).toContain('package_author_mismatch')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it("requires the base draft to be in the author's private person space", async () => {
    const ws = fixture()
    const { current } = await baseDraft(ws)
    current.space = 'public-space' as DefinitionPackageDraft['space']
    const result = await ws.call('package_create_version_draft', {
      ...input(),
      base: { draftId: current._id, expectedRevision: 1 }
    })
    expect(JSON.stringify(result)).toContain('invalid_draft_space')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('rejects changing a package kind or using an unavailable operation', async () => {
    const ws = fixture()
    const { current } = await baseDraft(ws)
    const base = { draftId: current._id, expectedRevision: 1 }
    const changedKind = await ws.call('package_create_version_draft', {
      ...input(),
      base,
      source:
        'version: 2\nkind: card\ncardTypes:\n  new_card:\n    label: Card\n    extends: card:class:Card\n    kind: 0\n'
    })
    expect(JSON.stringify(changedKind)).toContain('package_kind_mismatch')
    const unsupported = await ws.call('package_create_version_draft', {
      ...input(),
      base,
      source: source.replace('RequestApproval', 'InventedMethod')
    })
    expect(JSON.stringify(unsupported)).toContain('invalid_definition')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('creates the next version from a verified owned catalog release using only authenticated reads', async () => {
    const ws = fixture([author], undefined, 'https://catalog.test/api')
    const { current, release } = await baseDraft(ws)
    catalog(release, current.release)
    const result = await ws.call('package_create_version_draft', {
      ...input(),
      base: catalogBase(release),
      source: source.replace('label: Review', 'label: Version two')
    })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      revision: 1,
      package: { id: release.package.id, author, version: '1.0.1' },
      basedOn: { contentHash: release.contentHash, package: release.package }
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, options] of fetchMock.mock.calls) {
      expect(options?.method ?? 'GET').toBe('GET')
      expect(options?.headers).toMatchObject({ Authorization: 'Bearer private-token' })
      expect(new URL(String(url)).searchParams.get('id')).toBe(release.package.id)
      expect(new URL(String(url)).searchParams.get('author')).toBe(author)
    }
    expect(ws.createDoc.mock.calls[0][0]).toBe(marketplace.class.DefinitionPackageDraft)
    expect(ws.updateDoc).not.toHaveBeenCalled()
  })

  it('rejects an older catalog base when a newer version exists', async () => {
    const ws = fixture([author], undefined, 'https://catalog.test/api')
    const { current, release } = await baseDraft(ws)
    catalog(release, current.release, '1.0.1')
    const result = await ws.call('package_create_version_draft', { ...input(), base: catalogBase(release) })
    expect(JSON.stringify(result)).toContain('package_version_conflict')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('requires the inspected content hash instead of silently versioning a different source', async () => {
    const ws = fixture([author], undefined, 'https://catalog.test/api')
    const { current, release } = await baseDraft(ws)
    catalog(release, current.release)
    const result = await ws.call('package_create_version_draft', {
      ...input(),
      base: { ...catalogBase(release), contentHash: `sha256:${'0'.repeat(64)}` }
    })
    expect(JSON.stringify(result)).toContain('package_content_conflict')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('verifies downloaded author/ID/version independently of catalog metadata', async () => {
    const ws = fixture([author], undefined, 'https://catalog.test/api')
    const { release } = await baseDraft(ws)
    const incorrect = serializeDefinitionPackageRelease(
      await createDefinitionPackageRelease({
        package: { ...release.package, id: 'different/package' },
        source: release.source
      })
    )
    catalog(release, incorrect)
    const result = await ws.call('package_create_version_draft', { ...input(), base: catalogBase(release) })
    expect(JSON.stringify(result)).toContain('package_identity_mismatch')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('rejects a foreign catalog author before making a catalog request', async () => {
    const ws = fixture([author], undefined, 'https://catalog.test/api')
    const result = await ws.call('package_create_version_draft', {
      ...input(),
      base: { id: 'foreign/package', author: 'another-account', version: '1.0.0', contentHash: 'unused' }
    })
    expect(JSON.stringify(result)).toContain('package_author_mismatch')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('does not fall back to a new package identity if Marketplace is unavailable', async () => {
    const ws = fixture()
    const result = await ws.call('package_create_version_draft', {
      ...input(),
      base: { id: 'own/package', author, version: '1.0.0', contentHash: 'unused' }
    })
    expect(JSON.stringify(result)).toContain('marketplace_not_configured')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('keeps catalog errors safe and never publishes or installs on inaccessible releases', async () => {
    const ws = fixture([author], undefined, 'https://catalog.test/api')
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'private catalog details' }), { status: 404 })
    )
    const result = await ws.call('package_create_version_draft', {
      ...input(),
      base: { id: 'missing/package', author, version: '1.0.0', contentHash: 'unused' }
    })
    expect(JSON.stringify(result)).toContain('marketplace_package_not_found')
    expect(JSON.stringify(result)).not.toContain('private catalog details')
    expect(ws.apply).not.toHaveBeenCalled()
  })
})
