//
// Copyright © 2024 Hardcore Engineering Inc.
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

import { saveCollabJson } from '@hcengineering/collaboration'

import core, {
  type AnyAttribute,
  type Class,
  type Doc,
  type Domain,
  type Hierarchy,
  type LowLevelStorage,
  type MeasureContext,
  MeasureMetricsContext,
  RateLimiter,
  type Ref,
  type Tx,
  type WorkspaceIds,
  type WorkspaceUuid,
  groupByArray,
  isArchivingMode,
  isDeletingMode,
  makeDocCollabId,
  systemAccountUuid
} from '@hcengineering/core'

import { getDBClient } from '@hcengineering/postgres'
import { withRetry } from '@hcengineering/retry'
import { getAccountClient } from '@hcengineering/server-client'
import { type PipelineFactory, type StorageAdapter, createDummyStorageAdapter } from '@hcengineering/server-core'
import { createBackupPipeline, createEmptyBroadcastOps } from '@hcengineering/server-pipeline'
import { generateToken } from '@hcengineering/server-token'
import { isEmptyMarkup } from '@hcengineering/text-core'

import { type Sql } from 'postgres'

export async function restoreMarkupRefs (
  dbUrl: string,
  txes: Tx[],
  storageAdapter: StorageAdapter,
  region: string | null
): Promise<void> {
  const token = generateToken(systemAccountUuid, undefined, { service: 'tool', admin: 'true' })
  const ctx = new MeasureMetricsContext('restore-markup-ref', {})

  const accountClient = getAccountClient(token)
  ctx.info('fetching workspaces in region', { region })
  const workspaces = await accountClient.listWorkspaces()
  const workspacesById = workspaces.reduce((map, ws) => map.set(ws.uuid, ws), new Map())
  ctx.info('found workspaces in region', { region, count: workspaces.length })

  const factory: PipelineFactory = createBackupPipeline(ctx, dbUrl, txes, {
    externalStorage: createDummyStorageAdapter(),
    usePassedCtx: true
  })

  const pg = getDBClient(dbUrl)
  const pgClient = await pg.getClient()

  try {
    ctx.info('fetching workspaces to fix', { region })
    const targets = await pgClient<{ workspaceId: WorkspaceUuid, _class: Ref<Class<Doc>> }[]>`
      SELECT "workspaceId", _class, COUNT(*)
      FROM task
      WHERE data->>'description' LIKE '{%'
      GROUP BY "workspaceId", _class
    `

    const workspaceTargets = groupByArray(targets, (it) => it.workspaceId)
    ctx.info('found workspaces to fix', { region, count: workspaceTargets.size })

    for (const [wsUuid, targets] of workspaceTargets) {
      const workspace = workspacesById.get(wsUuid)
      if (workspace === undefined) {
        ctx.warn('workspace not found', { wsUuid, region })
        continue
      }

      const { uuid, name, url, mode } = workspace
      if (isArchivingMode(mode) || isDeletingMode(mode)) {
        ctx.warn('skipping workspace', { uuid, name, url, region, mode })
        continue
      }

      const classes = targets.map((it) => it._class)
      ctx.info('processing workspace', { uuid, name, url, region, classes })

      try {
        const pipeline = await factory(ctx, workspace, createEmptyBroadcastOps(), null)

        try {
          const { hierarchy, lowLevelStorage } = pipeline.context
          if (lowLevelStorage === undefined) {
            ctx.error('Low level storage not available', { region })
            continue
          }

          for (const _class of classes) {
            await restoreMarkupRefsForClass(
              ctx,
              _class,
              workspace,
              hierarchy,
              lowLevelStorage,
              storageAdapter,
              pgClient
            )
          }
        } finally {
          await pipeline.close()
        }
      } catch (err: any) {
        ctx.error('failed to process workspace', { err, uuid, name, url, region })
      }
    }
  } finally {
    pg.close()
  }
}

async function restoreMarkupRefsForClass (
  ctx: MeasureContext,
  _class: Ref<Class<Doc>>,
  wsIds: WorkspaceIds,
  hierarchy: Hierarchy,
  lowLevelStorage: LowLevelStorage,
  storageAdapter: StorageAdapter,
  pgClient: Sql
): Promise<void> {
  const workspace = wsIds.uuid
  const rateLimiter = new RateLimiter(10)

  const domain = hierarchy.findDomain(_class)
  if (domain === undefined) return

  const attributes = findCollabAttributes(hierarchy, _class)
  if (attributes.length === 0) return
  if (hierarchy.isMixin(_class) && attributes.every((p) => p.attributeOf !== _class)) return

  const query = hierarchy.isMixin(_class) ? { [_class]: { $exists: true } } : { _class }
  const iterator = await lowLevelStorage.traverse<Doc>(domain, query)

  let processed = 0

  try {
    while (true) {
      const docs = await iterator.next(100)
      if (docs === null || docs.length === 0) {
        break
      }

      for (const doc of docs) {
        await rateLimiter.add(async () => {
          try {
            await withRetry(() =>
              restoreMarkupRefsForDoc(
                ctx,
                doc,
                domain,
                attributes,
                wsIds,
                hierarchy,
                lowLevelStorage,
                storageAdapter,
                pgClient
              )
            )
            processed++
          } catch (err: any) {
            ctx.error('failed to restore markup refs', { doc: doc._id, class: doc._class, workspace })
          }
        })
      }

      await rateLimiter.waitProcessing()
      ctx.info('...', { _class, workspace, processed })
    }

    await rateLimiter.waitProcessing()
    ctx.info('done', { _class, workspace, processed })
  } finally {
    await iterator.close()
  }
}

async function restoreMarkupRefsForDoc (
  ctx: MeasureContext,
  doc: Doc,
  domain: Domain,
  attributes: AnyAttribute[],
  wsIds: WorkspaceIds,
  hierarchy: Hierarchy,
  lowLevelStorage: LowLevelStorage,
  storageAdapter: StorageAdapter,
  pgClient: Sql
): Promise<void> {
  const workspace = wsIds.uuid

  for (const attribute of attributes) {
    const value = hierarchy.isMixin(attribute.attributeOf)
      ? ((doc as any)[attribute.attributeOf]?.[attribute.name] as string)
      : ((doc as any)[attribute.name] as string)

    if (value == null || value === '') continue
    if (!value.startsWith('{')) continue

    const attributeName = hierarchy.isMixin(attribute.attributeOf)
      ? `${attribute.attributeOf}.${attribute.name}`
      : attribute.name

    if (isEmptyMarkup(value)) {
      // If the value is empty, we can just remove the attribute
      await lowLevelStorage.rawUpdate(domain, { _id: doc._id }, { [attributeName]: null })
    } else {
      // Otherwise try to find the most recent blob for this attribute
      const blobId = await findRecentBlobId(pgClient, workspace, doc, attribute)
      if (blobId !== undefined) {
        // If found, we need to update the document with the blobId
        ctx.info('updating blob', { doc: doc._id, class: doc._class, workspace, attribute: attribute.name, blobId })
        await lowLevelStorage.rawUpdate(domain, { _id: doc._id }, { [attributeName]: blobId })
      } else {
        // If not found, and the content is not empty, we need to save it and update the document with the blobId
        const collabId = makeDocCollabId(doc, attribute.name)
        const blobId = await withRetry(() => saveCollabJson(ctx, storageAdapter, wsIds, collabId, value))
        await lowLevelStorage.rawUpdate(domain, { _id: doc._id }, { [attributeName]: blobId })
        ctx.info('uploading blob', { doc: doc._id, class: doc._class, workspace, attribute: attribute.name, blobId })
      }
    }
  }
}

function findCollabAttributes (hierarchy: Hierarchy, _class: Ref<Class<Doc>>): AnyAttribute[] {
  const allAttributes = hierarchy.getAllAttributes(_class)
  return Array.from(allAttributes.values()).filter((attribute) => {
    return hierarchy.isDerived(attribute.type._class, core.class.TypeCollaborativeDoc)
  })
}

async function findRecentBlobId (
  sql: Sql,
  workspace: string,
  doc: Doc,
  attribute: AnyAttribute
): Promise<string | undefined> {
  const prefix = `${doc._id}-${attribute.name}-%`

  const [blobId] = await sql`
    SELECT name
    FROM blob.blob
    WHERE workspace = ${workspace} AND name LIKE ${prefix} AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `
  return blobId?.name
}
