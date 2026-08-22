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
import {
  type BackupClient,
  type Client as CoreClient,
  isArchivingMode,
  isDeletingMode,
  type MeasureMetricsContext
} from '@hcengineering/core'
import setting, { type WorkspaceSetting } from '@hcengineering/setting'
import { connect } from '@hcengineering/server-tool'
import { getWorkspaceTransactorEndpoint } from './utils'

/**
 * Backfills the account-service `Workspace.icon` field (renamed from `avatar` by v32) from
 * each workspace's own WorkspaceSetting.icon, for workspaces that had a logo before the
 * avatar-sync change (commit 23b5d24) or whose account-service copy still holds a v31-era
 * absolute URL. Stores the blob id as-is; the client resolves it into a URL itself.
 */
export async function backfillWorkspaceAvatars (
  ctx: MeasureMetricsContext,
  accountDb: AccountDB,
  opts: { force?: boolean, dryRun?: boolean, concurrency?: number } = {}
): Promise<void> {
  // isDisabled is left null here (rather than passing false) so getWorkspaces doesn't
  // dereference status.isDisabled itself — a workspace missing its status row would
  // throw there before we ever get a chance to skip it below.
  const rawWorkspaces = await getWorkspaces(accountDb, null, null, null)
  // A workspace can be missing its workspace_status row (e.g. mid-creation, or a data
  // inconsistency); skip those like any other per-workspace failure instead of letting
  // `it.status.mode` crash the whole run.
  const noStatus = rawWorkspaces.filter((it) => it.status == null).length
  // Disabled workspaces are skipped too: their transactor may not be reachable, and
  // there is no point spending a connect/close round trip backfilling a workspace that
  // isn't serving members anyway.
  const disabled = rawWorkspaces.filter((it) => it.status != null && it.status.isDisabled).length
  const workspaces = rawWorkspaces.filter(
    (it) =>
      it.status != null && !it.status.isDisabled && !isArchivingMode(it.status.mode) && !isDeletingMode(it.status.mode)
  )

  // One connect/close round trip per workspace is slow done strictly sequentially — on a
  // deployment with thousands of workspaces (the scale this tool is meant for) that can
  // take hours. Process a bounded number of workspaces concurrently instead.
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
  let missing = 0
  let failed = noStatus
  let nextIndex = 0

  async function processOne (workspace: (typeof workspaces)[number]): Promise<void> {
    if (opts.force !== true && workspace.icon != null && workspace.icon !== '') {
      skipped++
      return
    }

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

        if (icon == null || icon === '') {
          missing++
          return
        }

        ctx.info('  setting avatar', { workspace: workspace.uuid, name: workspace.name, icon })

        if (opts.dryRun !== true) {
          await accountDb.workspace.update({ uuid: workspace.uuid }, { icon })
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

  ctx.info('Workspace avatar backfill finished', { updated, skipped, missing, failed })
}
