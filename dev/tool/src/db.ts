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
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  type AccountDB,
  type Workspace,
  addSocialIdToPerson,
  ensurePerson,
  findFullSocialIdBySocialKey,
  findPersonBySocialKey,
  mergeSpecifiedPersons,
  mergeSpecifiedAccounts
} from '@hcengineering/account'
import { getFirstName, getLastName } from '@hcengineering/contact'
import {
  MeasureMetricsContext,
  SocialIdType,
  type PersonUuid,
  type SocialKey,
  type AccountUuid,
  parseSocialIdString,
  DOMAIN_SPACE
} from '@hcengineering/core'

import { getDBClient, setDBExtraOptions } from '@hcengineering/postgres'

import type postgres from 'postgres'
import { type Row } from 'postgres'
import { getToolToken } from './utils'

export async function migrateCreatedModifiedBy (
  ctx: MeasureMetricsContext,
  dbUrl: string,
  workspace: Workspace,
  includeDomains?: string[],
  excludeDomains?: string[],
  maxLifetimeSec?: number,
  batchSize?: number,
  force: boolean = false,
  maxReconnects: number = 30,
  maxRetries: number = 50
): Promise<void> {
  if (!dbUrl.startsWith('postgresql')) {
    throw new Error('Only PostgreSQL is supported')
  }

  const wsUuid = workspace.uuid
  ctx.info('Processing workspace', {
    workspaceUuid: workspace.uuid,
    workspaceName: workspace.name,
    workspaceUrl: workspace.url
  })

  if (maxLifetimeSec !== undefined) {
    setDBExtraOptions({ max_lifetime: maxLifetimeSec })
  }

  let progressMade = false
  let connectsCount = 0
  let retriesCount = 0
  let reconnecting = false
  let retrying = false
  let done = false
  let pg: ReturnType<typeof getDBClient> | undefined
  let pgClient: postgres.Sql | undefined

  while (!done && (connectsCount === 0 || retrying || (reconnecting && progressMade))) {
    try {
      if (connectsCount === 0 || reconnecting) {
        ctx.info(reconnecting ? '  Reconnecting...' : '  Connecting...')

        progressMade = false
        connectsCount++

        pg = getDBClient(dbUrl)
        pgClient = await pg.getClient()

        // Expect temp table with mapping to be created manually
        // Create mapping table
        await pgClient`
          CREATE TABLE IF NOT EXISTS temp_data.account_personid_mapping_v2 (
              workspace_id uuid,
              old_account_id text,
              new_person_id text,
              CONSTRAINT account_personid_mapping_v2_pk PRIMARY KEY (workspace_id, old_account_id)
          )
        `

        const [res] = await pgClient`SELECT COUNT(*) FROM temp_data.account_personid_mapping_v2`

        if (res.count === '0') {
          // Populate mapping table
          await pgClient`
            INSERT INTO temp_data.account_personid_mapping_v2
            WITH accounts as (
              SELECT 
                  tx."workspaceId" as workspace_id,
                  tx."objectId" as old_account_id,
                  COALESCE(
                      -- Get the latest email from updates
                      (
                          SELECT tx2.data->'operations'->>'email'
                          FROM model_tx tx2
                          WHERE tx2."objectId" = tx."objectId"
                              AND tx2."workspaceId" = tx."workspaceId"
                              AND tx2.data->>'objectClass' = 'contact:class:PersonAccount'
                              AND tx2.data->'operations'->>'email' IS NOT NULL
                          ORDER BY tx2."createdOn" DESC
                          LIMIT 1
                      ),
                      -- If no updates with email, get from create transaction
                      tx.data->'attributes'->>'email'
                  ) as latest_email
              FROM model_tx tx
              WHERE tx."_class" = 'core:class:TxCreateDoc'
              AND tx.data->>'objectClass' = 'contact:class:PersonAccount'
              AND tx.data->'attributes'->>'email' IS NOT null
            ),
            account_data as (
              SELECT
                workspace_id,
                old_account_id,
                CASE 
                    WHEN latest_email LIKE 'github:%' THEN lower(latest_email)
                    WHEN latest_email LIKE 'openid:%' THEN 'oidc:' || lower(substring(latest_email from 8))
                    ELSE 'email:' || lower(latest_email)
                END as social_key
              FROM accounts
              WHERE latest_email IS NOT NULL AND latest_email != ''
            )
            SELECT
              ad.workspace_id,
              ad.old_account_id,
              si."_id" as new_person_id
            FROM account_data ad
            JOIN global_account.social_id si ON si."key" = ad.social_key
            WHERE ad.old_account_id NOT IN ('core:account:System', 'core:account:ConfigUser')
            `
        }

        // Create progress table
        await pgClient`
          CREATE TABLE IF NOT EXISTS temp_data.account_personid_mapping_v2_progress (
              workspace_id text,
              domain text,
              field text,
              CONSTRAINT account_personid_mapping_v2_progress_pk PRIMARY KEY (workspace_id, domain, field)
          )
        `
      }

      if (pgClient == null) {
        throw new Error('Could not connect to postgres')
      }

      if (retrying) {
        retriesCount++
      }

      reconnecting = false
      retrying = false

      // Get list of tables to process
      const tables = await pgClient`
        SELECT table_name
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND column_name IN ('createdBy', 'modifiedBy')
        GROUP BY table_name
        HAVING COUNT(DISTINCT column_name) = 2
      `
      let filteredTables: Row[] = tables
      if (includeDomains != null && includeDomains.length > 0) {
        filteredTables = tables.filter((t) => includeDomains.includes(t.table_name))
      }
      if (excludeDomains != null && excludeDomains.length > 0) {
        filteredTables = filteredTables.filter((t) => !excludeDomains.includes(t.table_name))
      }

      ctx.info(`  Found ${filteredTables.length} tables to process`, {
        domains: filteredTables.map((t) => t.table_name)
      })

      // Process each table
      for (const table of filteredTables) {
        const tableName = table.table_name
        ctx.info(`  Processing table: ${tableName}`)

        const progress = await pgClient`
          SELECT field 
          FROM temp_data.account_personid_mapping_v2_progress
          WHERE workspace_id = ${wsUuid} AND domain = ${tableName}
        `

        const createdDone = !force && progress.some((p) => p.field === 'createdBy')
        const modifiedDone = !force && progress.some((p) => p.field === 'modifiedBy')

        // Get counts for logging
        const [createdByCount] = !createdDone
          ? await pgClient`
          SELECT COUNT(*) 
          FROM ${pgClient(tableName)} t
          JOIN temp_data.account_personid_mapping_v2 m ON t."workspaceId" = m.workspace_id AND t."createdBy" = m.old_account_id
          WHERE t."workspaceId" = ${wsUuid}
        `
          : [{ count: 0 }]

        const [modifiedByCount] = !modifiedDone
          ? await pgClient`
          SELECT COUNT(*) 
          FROM ${pgClient(tableName)} t
          JOIN temp_data.account_personid_mapping_v2 m ON t."workspaceId" = m.workspace_id AND t."modifiedBy" = m.old_account_id
          WHERE t."workspaceId" = ${wsUuid}
        `
          : [{ count: 0 }]

        ctx.info(
          `  Table ${tableName}: ${createdByCount.count} createdBy and ${modifiedByCount.count} modifiedBy records need updating`
        )

        if (createdByCount.count > 0) {
          ctx.info(`    Updating createdBy for ${tableName}...`)
          const startTime = Date.now()

          if (batchSize == null || batchSize > createdByCount.count) {
            ctx.info(`      Processing the whole table ${tableName}...`)
            await pgClient`
              UPDATE ${pgClient(tableName)}
              SET "createdBy" = m.new_person_id::text
              FROM temp_data.account_personid_mapping_v2 m
              WHERE ${pgClient(tableName)}."workspaceId" = ${wsUuid} AND ${pgClient(tableName)}."workspaceId" = m.workspace_id AND ${pgClient(tableName)}."createdBy" = m.old_account_id
            `
            progressMade = true
          } else {
            ctx.info(`      Processing the table ${tableName} in batches of ${batchSize}...`)
            let processed = 0
            while (true) {
              const res = await pgClient`
                UPDATE ${pgClient(tableName)}
                SET "createdBy" = m.new_person_id::text
                FROM temp_data.account_personid_mapping_v2 m
                WHERE ${pgClient(tableName)}."workspaceId" = ${wsUuid} AND ${pgClient(tableName)}."workspaceId" = m.workspace_id AND ${pgClient(tableName)}."createdBy" = m.old_account_id
                LIMIT ${batchSize}
              `
              progressMade = true
              if (res.count === 0) {
                break
              }
              processed += res.count
              const duration = (Date.now() - startTime) / 1000
              const rate = Math.round(processed / duration)
              ctx.info(
                `      Processing createdBy for ${tableName}: ${processed} rows in ${duration}s (${rate} rows/sec)`
              )
            }
          }

          await pgClient`INSERT INTO temp_data.account_personid_mapping_v2_progress (workspace_id, domain, field) VALUES (${wsUuid}, ${tableName}, 'createdBy') ON CONFLICT DO NOTHING`

          const duration = (Date.now() - startTime) / 1000
          const rate = Math.round(createdByCount.count / duration)
          ctx.info(
            `    Updated createdBy for ${tableName}: ${createdByCount.count} rows in ${duration}s (${rate} rows/sec)`
          )
        } else {
          if (createdDone) {
            ctx.info('    Skipping createdBy for table. Already done', { tableName })
          } else {
            await pgClient`INSERT INTO temp_data.account_personid_mapping_v2_progress (workspace_id, domain, field) VALUES (${wsUuid}, ${tableName}, 'createdBy') ON CONFLICT DO NOTHING`
          }
        }

        if (modifiedByCount.count > 0) {
          ctx.info(`    Updating modifiedBy for ${tableName}...`)
          const startTime = Date.now()

          if (batchSize == null || batchSize > modifiedByCount.count) {
            ctx.info(`    Processing the whole table ${tableName}...`)
            await pgClient`
              UPDATE ${pgClient(tableName)}
              SET "modifiedBy" = m.new_person_id::text
              FROM temp_data.account_personid_mapping_v2 m
              WHERE ${pgClient(tableName)}."workspaceId" = ${wsUuid} AND ${pgClient(tableName)}."workspaceId" = m.workspace_id AND ${pgClient(tableName)}."modifiedBy" = m.old_account_id
            `
            progressMade = true
          } else {
            ctx.info(`    Processing the table ${tableName} in batches of ${batchSize}...`)
            let processed = 0
            while (true) {
              const res = await pgClient`
                UPDATE ${pgClient(tableName)}
                SET "modifiedBy" = m.new_person_id::text
                FROM temp_data.account_personid_mapping_v2 m
                WHERE ${pgClient(tableName)}."workspaceId" = ${wsUuid} AND ${pgClient(tableName)}."workspaceId" = m.workspace_id AND ${pgClient(tableName)}."modifiedBy" = m.old_account_id
                LIMIT ${batchSize}
              `
              progressMade = true
              if (res.count === 0) {
                break
              }
              processed += res.count
              const duration = (Date.now() - startTime) / 1000
              const rate = Math.round(processed / duration)
              ctx.info(
                `    Processing modifiedBy for ${tableName}: ${processed} rows in ${duration}s (${rate} rows/sec)`
              )
            }
          }

          await pgClient`INSERT INTO temp_data.account_personid_mapping_v2_progress (workspace_id, domain, field) VALUES (${wsUuid}, ${tableName}, 'modifiedBy') ON CONFLICT DO NOTHING`

          const duration = (Date.now() - startTime) / 1000
          const rate = Math.round(modifiedByCount.count / duration)
          ctx.info(
            `    Updated modifiedBy for ${tableName}: ${modifiedByCount.count} rows in ${duration}s (${rate} rows/sec)`
          )
        } else {
          if (modifiedDone) {
            ctx.info('    Skipping modifiedBy for table. Already done', { tableName })
          } else {
            await pgClient`INSERT INTO temp_data.account_personid_mapping_v2_progress (workspace_id, domain, field) VALUES (${wsUuid}, ${tableName}, 'modifiedBy') ON CONFLICT DO NOTHING`
          }
        }
      }

      done = true
      ctx.info('Migration of created/modified completed successfully')
    } catch (err: any) {
      if (err.code === '40001' || err.code === '55P03') {
        // Retry transaction
        if (retriesCount === maxRetries) {
          ctx.error('Failed to migrate created/modified by. Max retries reached', { err })
        } else {
          retrying = true
          continue
        }
      }

      if (err.code === 'CONNECTION_CLOSED') {
        // Reconnect
        ctx.info('  Connection closed...')
        if (connectsCount === maxReconnects) {
          ctx.error('Failed to migrate created/modified by. Max reconnects reached', { err })
        } else {
          reconnecting = true
          continue
        }
      }

      throw err
    } finally {
      pg?.close()
    }
  }

  if (!done) {
    ctx.error('Failed to migrate created/modified by')
  }
}

async function fillAccountSocialKeyMapping (ctx: MeasureMetricsContext, pgClient: postgres.Sql): Promise<void> {
  ctx.info('Creating account to social key mapping table...')
  // Create schema
  await pgClient`CREATE SCHEMA IF NOT EXISTS temp_data`

  // Create mapping table
  await pgClient`
    CREATE TABLE IF NOT EXISTS temp_data.account_socialkey_mapping (
      workspace_id text,
      old_account_id text,
      new_social_key text,
      person_ref text,
      person_name text,
      INDEX idx_account_mapping_old_id (workspace_id, old_account_id)
  )
  `

  const [res] = await pgClient`SELECT COUNT(*) FROM temp_data.account_socialkey_mapping`

  if (res.count === '0') {
    // Populate mapping table
    await pgClient`
      INSERT INTO temp_data.account_socialkey_mapping
      WITH accounts AS (
        SELECT 
            tx."workspaceId",
            tx."objectId",
            COALESCE(
                -- Get the latest email from updates
                (
                    SELECT tx2.data->'operations'->>'email'
                    FROM model_tx tx2
                    WHERE tx2."objectId" = tx."objectId"
                        AND tx2."workspaceId" = tx."workspaceId"
                        AND tx2.data->>'objectClass' = 'contact:class:PersonAccount'
                        AND tx2.data->'operations'->>'email' IS NOT NULL
                    ORDER BY tx2."createdOn" DESC
                    LIMIT 1
                ),
                -- If no updates with email, get from create transaction
                tx.data->'attributes'->>'email'
            ) as latest_email,
            COALESCE(
                -- Get the latest person from updates
                (
                    SELECT (tx2.data->'operations'->>'person')::text
                    FROM model_tx tx2
                    WHERE tx2."objectId" = tx."objectId"
                        AND tx2."workspaceId" = tx."workspaceId"
                        AND tx2.data->>'objectClass' = 'contact:class:PersonAccount'
                        AND tx2.data->'operations'->>'person' IS NOT NULL
                    ORDER BY tx2."createdOn" DESC
                    LIMIT 1
                ),
                -- If no updates, get from create transaction
                (tx.data->'attributes'->>'person')::text
            ) as person_ref
        FROM model_tx tx
        WHERE tx."_class" = 'core:class:TxCreateDoc'
            AND tx.data->>'objectClass' = 'contact:class:PersonAccount'
            AND tx."objectId" NOT IN ('core:account:System', 'core:account:ConfigUser')
      )
      SELECT 
          a."workspaceId" as workspace_id,
          a."objectId" as old_account_id,
          CASE 
              WHEN a.latest_email LIKE 'github:%' THEN lower(a.latest_email)
              WHEN a.latest_email LIKE 'openid:%' THEN 'oidc:' || lower(substring(a.latest_email from 8))
              ELSE 'email:' || lower(a.latest_email)
          END as new_social_key,
          a.person_ref,
              c.data->>'name' as person_name
      FROM accounts as a
          LEFT JOIN public.contact c ON c."_id" = a.person_ref AND c."workspaceId" = a."workspaceId"
      WHERE a.latest_email IS NOT NULL 
          AND a.latest_email != ''
    `
  }
}

export async function migrateMergedAccounts (
  ctx: MeasureMetricsContext,
  dbUrl: string,
  accountDb: AccountDB
): Promise<void> {
  ctx.info('Migrating merged person accounts... ', {})

  if (!dbUrl.startsWith('postgresql')) {
    throw new Error('Only PostgreSQL is supported')
  }

  const pg = getDBClient(dbUrl)
  const pgClient = await pg.getClient()
  const token = getToolToken()

  try {
    await fillAccountSocialKeyMapping(ctx, pgClient)

    const personsAccounts = await pgClient`
      SELECT workspace_id, person_ref, array_agg(new_social_key) as social_keys
      FROM temp_data.account_socialkey_mapping
      WHERE new_social_key != 'email:huly.ai.bot@hc.engineering'
      GROUP BY workspace_id, person_ref
      HAVING count(*) > 1 
    `

    ctx.info('Processing persons with merged accounts ', { count: personsAccounts.length })
    let processed = 0
    let errors = 0

    for (const personAccounts of personsAccounts) {
      try {
        const socialKeys = personAccounts.social_keys

        // Every social id in the old account might either be already in the new account or not in the accounts at all
        // So we want to
        // 1. Take the first social id with the existing account
        // 2. Merge all other accounts into the first one
        // 3. Create social ids for the first account which haven't had their own accounts
        const toAdd = new Set<SocialKey>()
        const toMergePersons = new Set<PersonUuid>()
        const toMergeAccounts = new Set<AccountUuid>()
        for (const socialKey of socialKeys) {
          const socialIdKey = parseSocialIdString(socialKey)
          const socialId = await findFullSocialIdBySocialKey(ctx, accountDb, null, token, { socialKey })
          const personUuid = socialId?.personUuid
          const accountUuid = (await findPersonBySocialKey(ctx, accountDb, null, token, {
            socialString: socialKey,
            requireAccount: true
          })) as AccountUuid

          if (personUuid == null) {
            toAdd.add(socialIdKey)
            // Means not attached to any account yet, simply add the social id to the primary account
          } else if (accountUuid == null) {
            toMergePersons.add(personUuid)
          } else {
            // This is the case when the social id is already attached to an account. Merge the accounts.
            toMergeAccounts.add(accountUuid)
          }
        }

        if (toMergeAccounts.size === 0) {
          // No existing accounts for the person's social ids. Normally this should never be the case.
          ctx.info('No existing accounts for person', personAccounts)
          continue
        }

        const toMergeAccountsArray = Array.from(toMergeAccounts)
        const primaryAccount = toMergeAccountsArray[0]

        for (let i = 1; i < toMergeAccountsArray.length; i++) {
          const accountToMerge = toMergeAccountsArray[i]
          await mergeSpecifiedAccounts(ctx, accountDb, null, token, {
            primaryAccount,
            secondaryAccount: accountToMerge
          })
        }

        const toMergePersonsArray = Array.from(toMergePersons)
        for (const personToMerge of toMergePersonsArray) {
          await mergeSpecifiedPersons(ctx, accountDb, null, token, {
            primaryPerson: primaryAccount,
            secondaryPerson: personToMerge
          })
        }

        for (const addTarget of Array.from(toAdd)) {
          await addSocialIdToPerson(ctx, accountDb, null, token, {
            person: primaryAccount,
            ...addTarget,
            confirmed: false
          })
        }

        processed++
        if (processed % 10 === 0) {
          ctx.info(`Processed ${processed} of ${personsAccounts.length} persons`)
        }
      } catch (err: any) {
        errors++
        ctx.error('Failed to merge accounts for person', { mergedGroup: personAccounts, err })
      }
    }

    ctx.info('Finished processing persons with merged accounts', { processed, of: personsAccounts.length, errors })
  } catch (err: any) {
    ctx.error('Failed to migrate merged accounts', { err })
  } finally {
    pg.close()
  }
}

export async function filterMergedAccountsInMembers (
  ctx: MeasureMetricsContext,
  dbUrl: string,
  accountDb: AccountDB
): Promise<void> {
  ctx.info('Filtering merged accounts in members... ', {})

  if (!dbUrl.startsWith('postgresql')) {
    throw new Error('Only PostgreSQL is supported')
  }

  const pg = getDBClient(dbUrl)
  const pgClient = await pg.getClient()

  try {
    const mergedPersons = await accountDb.person.find({ migratedTo: { $ne: null } })

    if (mergedPersons.length === 0) {
      ctx.info('No merged persons to migrate')
      return
    }

    ctx.info('Merged persons found', { count: mergedPersons.length })

    const migrationMap = new Map<PersonUuid, PersonUuid>()
    for (const person of mergedPersons) {
      if (person.migratedTo == null) {
        continue
      }

      migrationMap.set(person.uuid, person.migratedTo)
    }

    const spacesToUpdate = await pgClient`
      SELECT "workspaceId", _id, members FROM ${pgClient(DOMAIN_SPACE)} WHERE members && ${pgClient.array(Array.from(migrationMap.keys()))}
    `

    ctx.info('Spaces to update', { count: spacesToUpdate.length })

    let processed = 0
    let errors = 0
    for (const space of spacesToUpdate) {
      try {
        const newMembers = new Set<PersonUuid>(space.members.map((it: PersonUuid) => migrationMap.get(it) ?? it))

        await pgClient`
          UPDATE ${pgClient(DOMAIN_SPACE)} SET members = ${pgClient.array(Array.from(newMembers))}
          WHERE "workspaceId" = ${space.workspaceId}
          AND "_id" = ${space._id}
        `
        processed++
      } catch (err: any) {
        errors++
        ctx.error('Failed to update space members', { space, err })
      }
    }

    ctx.info('Finished updating spaces', { processed, of: spacesToUpdate.length, errors })
  } finally {
    pg.close()
  }
}

export async function ensureGlobalPersonsForLocalAccounts (
  ctx: MeasureMetricsContext,
  dbUrl: string,
  accountDb: AccountDB
): Promise<void> {
  ctx.info('Ensuring global persons for local accounts... ', {})

  if (!dbUrl.startsWith('postgresql')) {
    throw new Error('Only PostgreSQL is supported')
  }

  const pg = getDBClient(dbUrl)
  const pgClient = await pg.getClient()
  const token = getToolToken()

  try {
    await fillAccountSocialKeyMapping(ctx, pgClient)

    let count = 0
    let failed = 0
    const accountToSocialKey = await pgClient`SELECT * FROM temp_data.account_socialkey_mapping`
    for (const row of accountToSocialKey) {
      const newSocialKey = row.new_social_key
      const personName = row.person_name ?? ''

      const keyParts = newSocialKey.split(':')
      if (keyParts.length !== 2) {
        ctx.error('Invalid social key', row)
        continue
      }

      const keyType = keyParts[0]
      const keyValue = keyParts[1]

      if (!Object.values(SocialIdType).includes(keyType)) {
        ctx.error('Invalid social key type', row)
        continue
      }

      const firstName = getFirstName(personName)
      const lastName = getLastName(personName)
      const effectiveFirstName = firstName === '' ? keyValue : firstName

      try {
        await ensurePerson(ctx, accountDb, null, token, {
          socialType: keyType as SocialIdType,
          socialValue: keyValue,
          firstName: effectiveFirstName,
          lastName
        })
        count++
      } catch (err: any) {
        ctx.error('Failed to ensure person', {
          socialType: keyType as SocialIdType,
          socialValue: keyValue,
          firstName: effectiveFirstName,
          lastName
        })
        failed++
      }
    }

    ctx.info(`Successfully ensured ${count} people with failed count ${failed}`)
  } finally {
    pg.close()
  }
}
