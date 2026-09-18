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

import { type AccountDB, getWorkspaces } from '@hcengineering/account'
import core, {
  type BackupClient,
  type Blob,
  type Client as CoreClient,
  isArchivingMode,
  isDeletingMode,
  type MeasureMetricsContext,
  type Ref,
  TxOperations,
  type WorkspaceIds
} from '@hcengineering/core'
import setting, { type WorkspaceSetting } from '@hcengineering/setting'
import { connect } from '@hcengineering/server-tool'
import { buildStorageFromConfig, storageConfigFromEnv } from '@hcengineering/server-storage'
import { getWorkspaceTransactorEndpoint } from './utils'

/**
 * Copies legacy workspace logos (random blob id) to the fixed `logo` key and repoints
 * `WorkspaceSetting.icon` at it. The source blob is kept, so the run is repeatable.
 */
export async function backfillWorkspaceAvatars (
  ctx: MeasureMetricsContext,
  accountDb: AccountDB,
  opts: { force?: boolean, dryRun?: boolean, concurrency?: number } = {}
): Promise<void> {
  const storageAdapter = buildStorageFromConfig(storageConfigFromEnv())
  try {
    const workspaceLogoId = 'logo' as Ref<Blob>
    // isDisabled is null so getWorkspaces doesn't fail on workspaces without a status row.
    const rawWorkspaces = await getWorkspaces(accountDb, null, null, null)
    const noStatus = rawWorkspaces.filter((it) => it.status == null).length
    const disabled = rawWorkspaces.filter((it) => it.status != null && it.status.isDisabled).length
    const workspaces = rawWorkspaces.filter(
      (it) =>
        it.status != null &&
        !it.status.isDisabled &&
        !isArchivingMode(it.status.mode) &&
        !isDeletingMode(it.status.mode)
    )

    const concurrency = Math.min(Math.max(1, opts.concurrency ?? 10), Math.max(1, workspaces.length))

    ctx.info('Backfilling workspace avatars', {
      count: workspaces.length,
      noStatus,
      disabled,
      concurrency,
      force: opts.force === true,
      dryRun: opts.dryRun === true
    })

    let updated = 0
    let skipped = 0
    let noIcon = 0
    let blobMissing = 0
    let failed = 0
    let nextIndex = 0

    async function processOne (workspace: (typeof workspaces)[number]): Promise<void> {
      try {
        const endpoint = await getWorkspaceTransactorEndpoint(workspace.uuid)
        const connection = (await connect(endpoint, workspace.uuid, undefined, {
          mode: 'backup'
        })) as unknown as CoreClient & BackupClient
        try {
          const wsSetting = await connection.findOne<WorkspaceSetting>(setting.class.WorkspaceSetting, {
            _id: setting.ids.WorkspaceSetting
          })
          const icon = wsSetting?.icon

          if (wsSetting === undefined || icon == null || icon === '') {
            noIcon++
            return
          }

          // Already on the fixed key: nothing to copy, even with --force.
          if (icon === workspaceLogoId) {
            skipped++
            return
          }

          const workspaceIds: WorkspaceIds = {
            uuid: workspace.uuid,
            url: workspace.url,
            dataId: workspace.dataId
          }
          // Read-only checks run in --dry-run too, so its report matches a real run.
          if (opts.force !== true && (await storageAdapter.stat(ctx, workspaceIds, workspaceLogoId)) !== undefined) {
            // The key is taken by another blob; overwrite only with --force.
            ctx.warn('  logo key already taken, skipping', { workspace: workspace.uuid, name: workspace.name })
            skipped++
            return
          }
          const blobInfo = await storageAdapter.stat(ctx, workspaceIds, icon)
          if (blobInfo === undefined) {
            ctx.warn('  icon blob is missing in storage', { workspace: workspace.uuid, icon })
            blobMissing++
            return
          }

          ctx.info('  setting avatar', { workspace: workspace.uuid, name: workspace.name, icon })

          if (opts.dryRun !== true) {
            const data = await storageAdapter.get(ctx, workspaceIds, icon)
            await storageAdapter.put(ctx, workspaceIds, workspaceLogoId, data, blobInfo.contentType, blobInfo.size)

            const ops = new TxOperations(connection, core.account.System)
            await ops.update(wsSetting, { icon: workspaceLogoId })
          }
          updated++
        } finally {
          await connection.close()
        }
      } catch (err: any) {
        ctx.error('Failed to backfill workspace avatar', { workspace: workspace.uuid, name: workspace.name, err })
        failed++
      }
    }

    async function worker (): Promise<void> {
      while (true) {
        const index = nextIndex++
        if (index >= workspaces.length) {
          return
        }
        await processOne(workspaces[index])
      }
    }

    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        await worker()
      })
    )

    ctx.info('Workspace avatar backfill finished', { updated, skipped, noIcon, blobMissing, failed })
  } finally {
    await storageAdapter.close()
  }
}
