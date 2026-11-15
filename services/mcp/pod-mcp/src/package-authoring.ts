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
import { generateId, type AccountUuid, type Data, type Ref } from '@hcengineering/core'
import marketplace, {
  createDefinitionPackageMetadata,
  createDefinitionPackageRelease,
  parseDefinitionPackageRelease,
  serializeDefinitionPackageRelease,
  DefinitionPackageError,
  MarketplaceError,
  MarketplaceClient,
  type CatalogPackageIdentity,
  type DefinitionPackageRelease,
  type DefinitionPackageDraft,
  type DefinitionPackageManifest
} from '@hcengineering/marketplace'
import {
  compileProcessYaml,
  exportAuthoringModel,
  getAuthoringCatalog,
  ProcessAuthoringError,
  validateAuthoringModelOperations,
  type ProcessAuthoringResult
} from '@hcengineering/process'
import { fromJsonSchema, type CallToolResult, type McpServer } from '@modelcontextprotocol/server'
import type { TraceXAuthInfo } from './auth'
import { jsonStructuredText, jsonText } from './mcp'
import { readPackageAuthoringGuide } from './package-authoring-guide'
import type { PackageAuthorizer } from './package-authoring-access'
import type { WorkspaceConnection, WorkspaceManager } from './workspace'
import { PackageDiscoveryError, readCatalogPackageRelease, registerPackageDiscoveryTools } from './package-discovery'

interface DraftInput {
  workspace: string
  source: string
  name: string
  description: string
  review: string
  draftId?: string
  expectedRevision?: number
}

interface VersionDraftInput extends Omit<DraftInput, 'draftId' | 'expectedRevision'> {
  base:
    { draftId: string, expectedRevision: number } | { id: string, author: string, version: string, contentHash: string }
}

interface VersionDraftBase {
  release: DefinitionPackageRelease
  draft?: DefinitionPackageDraft
}

class PackageAuthoringError extends Error {
  constructor (
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'PackageAuthoringError'
  }
}

/** Checks the source against installed operations and makes inferred outputs portable. */
export function validatePackageDraft (
  source: string,
  connection: WorkspaceConnection
): { source: string, definition: ProcessAuthoringResult } {
  const model = connection.client.getModel()
  const definition = compileProcessYaml(source, model)
  validateAuthoringModelOperations(definition.docs, model, connection.client.getHierarchy())
  return { definition, source: exportAuthoringModel(definition.docs, definition.kind, getAuthoringCatalog(model)) }
}

async function loadDraft (
  connection: WorkspaceConnection,
  author: AccountUuid,
  id: string
): Promise<DefinitionPackageDraft> {
  const draft = await connection.client.findOne(marketplace.class.DefinitionPackageDraft, {
    _id: id as Ref<DefinitionPackageDraft>,
    author
  })
  if (draft === undefined) throw new PackageAuthoringError('draft_not_found', 'Package draft not found')
  return draft
}

/** Saves only a private draft, retaining package identity across optimistic draft revisions. */
export async function savePackageDraft (
  args: DraftInput,
  connection: WorkspaceConnection,
  base?: VersionDraftBase
): Promise<Record<string, unknown>> {
  const author = connection.token.account
  const current = args.draftId === undefined ? undefined : await loadDraft(connection, author, args.draftId)
  if ((args.draftId === undefined) !== (args.expectedRevision === undefined)) {
    throw new PackageAuthoringError('revision_required', 'Supply draftId and expectedRevision together when updating')
  }
  if (current !== undefined && args.expectedRevision !== current.revision) {
    throw new PackageAuthoringError(
      'draft_conflict',
      'The draft changed; reload it with package.get_draft before editing'
    )
  }
  if (base !== undefined && current !== undefined) {
    throw new PackageAuthoringError('version_requires_new_draft', 'A new version must create a separate draft')
  }
  if (base !== undefined && base.release.package.author !== author) {
    throw new PackageAuthoringError(
      'package_author_mismatch',
      'Only the original package author can create a new version'
    )
  }
  const currentRelease = current === undefined ? undefined : await parseDefinitionPackageRelease(current.release)
  const name = args.name.trim()
  if (name.length === 0) throw new PackageAuthoringError('invalid_name', 'Provide a nonempty draft name')
  const validated = validatePackageDraft(args.source, connection)
  const previousRelease = base?.release ?? currentRelease
  if (previousRelease !== undefined && validated.definition.kind !== previousRelease.definition.kind) {
    throw new PackageAuthoringError(
      'package_kind_mismatch',
      'An existing package must retain its kind; create a separate package instead'
    )
  }
  const manifest: DefinitionPackageManifest =
    currentRelease === undefined
      ? createDefinitionPackageMetadata(
          author,
          args.description,
          base === undefined ? undefined : { ...base.release.package, author }
        )
      : { ...currentRelease.package, description: args.description.trim() }
  if (manifest.author !== author) throw new PackageAuthoringError('draft_author_mismatch', 'The draft author changed')
  const release = serializeDefinitionPackageRelease(
    await createDefinitionPackageRelease({
      package: manifest,
      source: validated.source
    })
  )
  const person = await connection.client.findOne(contact.class.Person, { personUuid: author })
  const space =
    person === undefined
      ? undefined
      : await connection.client.findOne(contact.class.PersonSpace, { person: person._id })
  if (space === undefined || !space.private || !space.members.includes(author)) {
    throw new PackageAuthoringError(
      'private_space_required',
      'Sign in to the TraceX UI to initialize your private person space'
    )
  }
  const storedDraft = current ?? base?.draft
  if (storedDraft !== undefined && storedDraft.space !== space._id) {
    throw new PackageAuthoringError('invalid_draft_space', 'The draft is outside your private person space')
  }
  const id = current?._id ?? generateId<DefinitionPackageDraft>()
  const revision = (current?.revision ?? 0) + 1
  const updates: Omit<Data<DefinitionPackageDraft>, 'author'> = { name, review: args.review.trim(), release, revision }
  const apply = connection.client.apply('Save package draft')
  if (current === undefined) {
    if (base?.draft !== undefined) {
      apply.match(base.draft._class, {
        _id: base.draft._id,
        author,
        revision: base.draft.revision,
        modifiedOn: base.draft.modifiedOn
      })
    }
    apply.notMatch(marketplace.class.DefinitionPackageDraft, { _id: id })
    const data: Data<DefinitionPackageDraft> = { ...updates, author }
    await apply.createDoc(marketplace.class.DefinitionPackageDraft, space._id, data, id)
  } else {
    apply.match(current._class, { _id: id, author, revision: current.revision, modifiedOn: current.modifiedOn })
    await apply.updateDoc(marketplace.class.DefinitionPackageDraft, space._id, id, updates)
  }
  if (!(await apply.commit(true)).result) {
    throw new PackageAuthoringError('draft_conflict', 'The draft changed; reload it before editing')
  }
  return {
    draftId: id,
    revision,
    name,
    package: manifest,
    next: 'Open Settings → Package drafts in this workspace to review and download or install. Nothing has been installed or published.'
  }
}

/** Forks an owned draft or a verified current catalog release into a private next-version draft. */
export async function createPackageVersionDraft (
  args: VersionDraftInput,
  connection: WorkspaceConnection,
  marketplaceUrl?: string,
  accountToken?: string
): Promise<Record<string, unknown>> {
  const author = connection.token.account
  let base: VersionDraftBase
  if ('draftId' in args.base) {
    const draft = await loadDraft(connection, author, args.base.draftId)
    if (draft.revision !== args.base.expectedRevision) {
      throw new PackageAuthoringError('draft_conflict', 'The base draft changed; reload it with package.get_draft')
    }
    base = { release: await parseDefinitionPackageRelease(draft.release), draft }
  } else {
    if (args.base.author !== author) {
      throw new PackageAuthoringError(
        'package_author_mismatch',
        'Only the original package author can create a new version'
      )
    }
    if (marketplaceUrl === undefined || marketplaceUrl.trim() === '') {
      throw new PackageDiscoveryError(
        'marketplace_not_configured',
        'Configure MARKETPLACE_URL to edit a catalog release'
      )
    }
    if (accountToken === undefined)
      {throw new PackageAuthoringError('account_token_required', 'Catalog access requires the authenticated account')}
    const identity: CatalogPackageIdentity = { id: args.base.id, author }
    const { release, latestVersion } = await readCatalogPackageRelease(
      new MarketplaceClient(marketplaceUrl, accountToken),
      identity,
      args.base.version
    )
    if (latestVersion !== args.base.version) {
      throw new PackageAuthoringError(
        'package_version_conflict',
        'A newer release is available; inspect it before creating a version'
      )
    }
    if (release.contentHash !== args.base.contentHash) {
      throw new PackageAuthoringError(
        'package_content_conflict',
        'The base content hash does not match; inspect the release again'
      )
    }
    base = { release }
  }
  const result = await savePackageDraft(args, connection, base)
  return {
    ...result,
    basedOn: {
      package: base.release.package,
      contentHash: base.release.contentHash,
      ...(base.draft === undefined ? {} : { draftId: base.draft._id, revision: base.draft.revision })
    }
  }
}

/** Registers package tools with an account allowlist enforced before every workspace access. */
export function registerPackageAuthoringTools (
  server: McpServer,
  auth: TraceXAuthInfo,
  manager: WorkspaceManager,
  authorize: PackageAuthorizer,
  marketplaceUrl?: string
): void {
  const execute = async (
    workspace: string,
    operation: (connection: WorkspaceConnection) => Promise<Record<string, unknown>>
  ): Promise<CallToolResult> => {
    let allowed: boolean
    try {
      allowed = await authorize(auth)
    } catch {
      return jsonText(
        {
          error: {
            code: 'package_authoring_unavailable',
            message: 'Package authoring access could not be verified. Try again later.'
          }
        },
        true
      )
    }
    if (!allowed) {
      return jsonText(
        {
          error: {
            code: 'package_authoring_forbidden',
            message: 'Package authoring is disabled for this account. Contact the TraceX administrator.'
          }
        },
        true
      )
    }
    try {
      const connection = await manager.getConnection(auth.extra.accountToken, workspace, auth.extra.workspaceId)
      if (connection.token.account !== auth.extra.account) {
        throw new PackageAuthoringError('account_mismatch', 'The workspace belongs to another account')
      }
      return jsonStructuredText({ workspace, installation: String(auth.resource), ...(await operation(connection)) })
    } catch (error) {
      if (error instanceof PackageAuthoringError || error instanceof PackageDiscoveryError) {
        return jsonText({ error: { code: error.code, message: error.message } }, true)
      }
      if (error instanceof MarketplaceError) {
        return jsonText(
          {
            error: {
              code: error.status === 404 ? 'marketplace_package_not_found' : 'marketplace_request_failed',
              message:
                error.status === 404
                  ? 'Package or release not found'
                  : 'The Marketplace request failed; check catalog access and service availability',
              status: error.status
            }
          },
          true
        )
      }
      if (error instanceof ProcessAuthoringError || error instanceof DefinitionPackageError) {
        return jsonText(
          {
            error: {
              code: 'invalid_definition',
              message: error.message,
              path: error.path,
              ...(error instanceof ProcessAuthoringError ? { line: error.line, column: error.column } : {})
            }
          },
          true
        )
      }
      return jsonText(
        {
          error: {
            code: 'package_authoring_failed',
            message: 'Package authoring failed. Check workspace access, guide section and installed model, then retry.'
          }
        },
        true
      )
    }
  }
  registerPackageDiscoveryTools(server, execute, auth, marketplaceUrl)
  const workspace = { type: 'string', minLength: 1, description: 'Exact workspace ID from my.workspaces.' }
  server.registerTool(
    'package.authoring_guide',
    {
      description:
        'Read the canonical TraceX YAML v2 guide before designing a package. Returns available sections and worked examples. Restricted to administrator-approved authors. AI generation runs in your client.',
      inputSchema: fromJsonSchema<{ workspace: string, section?: string }>({
        type: 'object',
        properties: {
          workspace,
          section: {
            type: 'string',
            description:
              'Exact heading returned by this tool, schema, or example:<listed filename>. Defaults to Start here.'
          }
        },
        required: ['workspace'],
        additionalProperties: false
      })
    },
    async (args) => await execute(args.workspace, async () => await readPackageAuthoringGuide(args.section))
  )
  server.registerTool(
    'package.contracts',
    {
      description:
        'Get installed process methods, triggers and functions for package authoring. Use card.list_master_tags and card.master_tag_details for existing card fields. Contracts do not universally describe optional parameters or execution semantics; consult package.authoring_guide and stop on unsupported requirements.',
      inputSchema: fromJsonSchema<{ workspace: string }>({
        type: 'object',
        properties: { workspace },
        required: ['workspace'],
        additionalProperties: false
      })
    },
    async (args) =>
      await execute(args.workspace, async (connection) => ({
        catalog: getAuthoringCatalog(connection.client.getModel())
      }))
  )
  server.registerTool(
    'package.validate',
    {
      description:
        'Compile a plain version: 2 card module or process bundle against installed operation contracts without writing. Returns portable YAML with explicit outputs. This does not prove runtime behavior or destination bindings; UI installation review and manual execution are still required.',
      inputSchema: fromJsonSchema<{ workspace: string, source: string }>({
        type: 'object',
        properties: { workspace, source: { type: 'string', minLength: 1, maxLength: 1048576 } },
        required: ['workspace', 'source'],
        additionalProperties: false
      })
    },
    async (args) =>
      await execute(args.workspace, async (connection) => {
        const { source, definition } = validatePackageDraft(args.source, connection)
        return {
          valid: true,
          kind: definition.kind,
          documents: definition.docs.length,
          source,
          installationReviewRequired: true
        }
      })
  )
  server.registerTool(
    'package.get_draft',
    {
      description:
        'Read your own private package draft and its revision before making changes. Does not install or publish.',
      inputSchema: fromJsonSchema<{ workspace: string, draftId: string }>({
        type: 'object',
        properties: { workspace, draftId: { type: 'string', minLength: 1 } },
        required: ['workspace', 'draftId'],
        additionalProperties: false
      })
    },
    async (args) =>
      await execute(args.workspace, async (connection) => {
        const draft = await loadDraft(connection, connection.token.account, args.draftId)
        const release = await parseDefinitionPackageRelease(draft.release)
        return {
          draftId: draft._id,
          revision: draft.revision,
          name: draft.name,
          review: draft.review,
          package: release.package,
          source: release.source
        }
      })
  )
  server.registerTool(
    'package.create_version_draft',
    {
      description:
        'Create a private next-version draft of your own package after explicit user intent. First inspect the current Marketplace release or read your own base draft. Supply edited plain YAML and a review. Retains package ID and author, automatically increments the patch version and creates a fresh draft at revision 1. base is either {draftId, expectedRevision} or {id, author, version, contentHash} from package.inspect. Existing releases and drafts are unchanged. Edit the result with package.get_draft and package.save_draft; those edits increment only draft revision. Never installs, executes or publishes.',
      inputSchema: fromJsonSchema<VersionDraftInput>({
        type: 'object',
        properties: {
          workspace,
          source: { type: 'string', minLength: 1, maxLength: 1048576 },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 4000 },
          review: { type: 'string', minLength: 1, maxLength: 32000 },
          base: {
            description:
              'Use the exact metadata returned by package.get_draft or package.inspect. Only your own packages can be versioned.',
            oneOf: [
              {
                type: 'object',
                properties: {
                  draftId: { type: 'string', minLength: 1 },
                  expectedRevision: { type: 'integer', minimum: 1 }
                },
                required: ['draftId', 'expectedRevision'],
                additionalProperties: false
              },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', minLength: 1 },
                  author: { type: 'string', minLength: 1 },
                  version: { type: 'string', minLength: 1, maxLength: 200 },
                  contentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }
                },
                required: ['id', 'author', 'version', 'contentHash'],
                additionalProperties: false
              }
            ]
          }
        },
        required: ['workspace', 'source', 'name', 'description', 'review', 'base'],
        additionalProperties: false
      })
    },
    async (args) =>
      await execute(
        args.workspace,
        async (connection) => await createPackageVersionDraft(args, connection, marketplaceUrl, auth.extra.accountToken)
      )
  )
  server.registerTool(
    'package.save_draft',
    {
      description:
        'Validate and save a private package draft for explicit UI review. Requires user intent to save. Search and inspect reusable packages and installed processes before creating new logic. Supply a plain YAML v2 definition and a review explaining fields, states, ordered actions, reused package identities/versions, context dependencies, bindings and manual acceptance scenarios. The authenticated account becomes the author. For edits first use package.get_draft and supply draftId with expectedRevision; editing retains the release version. For a new version of an existing package use package.create_version_draft. Never installs, executes or publishes definitions.',
      inputSchema: fromJsonSchema<DraftInput>({
        type: 'object',
        properties: {
          workspace,
          source: { type: 'string', minLength: 1, maxLength: 1048576 },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 4000 },
          review: { type: 'string', minLength: 1, maxLength: 32000 },
          draftId: { type: 'string', minLength: 1 },
          expectedRevision: { type: 'integer', minimum: 1 }
        },
        required: ['workspace', 'source', 'name', 'description', 'review'],
        additionalProperties: false
      })
    },
    async (args) => await execute(args.workspace, async (connection) => await savePackageDraft(args, connection))
  )
}
