//
// Copyright © 2026 Hardcore Engineering Inc.
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
import { type BackupClient, type Client as CoreClient, isArchivingMode, isDeletingMode, MeasureMetricsContext } from '@hcengineering/core'
import setting, { type WorkspaceSetting } from '@hcengineering/setting'
import { createFileStorage } from '@hcengineering/storage-client'
import { connect } from '@hcengineering/server-tool'
import { getWorkspaceTransactorEndpoint } from './utils'

/**
 * Backfills the account-service `Workspace.avatar` field (added by the
 * account_db_v31_add_workspace_avatar migration) from each workspace's own
 * WorkspaceSetting.icon. The migration only adds the column — it cannot
 * populate it itself, because the source data lives in each workspace's own
 * database, not in the account database. Without this, workspaces that had
 * a logo configured before the avatar-sync change (commit 23b5d24) never
 * get an avatar on the select-workspace / workspace-switcher screens until
 * someone re-saves the icon on the settings page.
 */
export async function backfillWorkspaceAvatars (
  ctx: MeasureMetricsContext,
  accountDb: AccountDB,
  opts: { force?: boolean, dryRun?: boolean } = {}
): Promise<void> {
  const uploadUrl = process.env.UPLOAD_URL
  const datalakeUrl = process.env.DATALAKE_URL
  const hulylakeUrl = process.env.HULYLAKE_URL

  if ((uploadUrl ?? '') === '' && (datalakeUrl ?? '') === '' && (hulylakeUrl ?? '') === '') {
    throw new Error(
      'At least one of UPLOAD_URL, DATALAKE_URL, HULYLAKE_URL must be set to build absolute avatar URLs ' +
        '(same values the front service uses to serve config.json to the browser)'
    )
  }

  const fileStorage = createFileStorage({ uploadUrl: uploadUrl ?? '', datalakeUrl, hulylakeUrl })

  const rawWorkspaces = await getWorkspaces(accountDb, null, null, null)
  const workspaces = rawWorkspaces.filter((it) => !isArchivingMode(it.status.mode) && !isDeletingMode(it.status.mode))

  ctx.info('Backfilling workspace avatars', { count: workspaces.length, force: opts.force === true, dryRun: opts.dryRun === true })

  let updated = 0
  let skipped = 0
  let missing = 0
  let failed = 0

  for (const workspace of workspaces) {
    if (opts.force !== true && workspace.avatar != null && workspace.avatar !== '') {
      skipped++
      continue
    }

    try {
      const endpoint = await getWorkspaceTransactorEndpoint(workspace.uuid)
      const connection = (await connect(endpoint, workspace.uuid, undefined, { mode: 'backup' })) as unknown as CoreClient &
      BackupClient
      try {
        const wsSetting = await connection.findOne<WorkspaceSetting>(setting.class.WorkspaceSetting, {
          _id: setting.ids.WorkspaceSetting
        })
        const icon = wsSetting?.icon

        if (icon == null || icon === '') {
          missing++
          continue
        }

        const avatarUrl = fileStorage.getFileUrl(workspace.uuid, icon)

        ctx.info('  setting avatar', { workspace: workspace.uuid, name: workspace.name, avatarUrl })

        if (opts.dryRun !== true) {
          await accountDb.workspace.update({ uuid: workspace.uuid }, { avatar: avatarUrl })
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

  ctx.info('Workspace avatar backfill finished', { updated, skipped, missing, failed })
}
