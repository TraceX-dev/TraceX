//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { config as loadEnv } from 'dotenv'
import { setMetadata } from '@hcengineering/platform'
import { createOpenTelemetryMetricsContext, SplitLogger } from '@hcengineering/analytics-service'
import { newMetrics } from '@hcengineering/core'
import serverClient from '@hcengineering/server-client'
import { initStatisticsContext } from '@hcengineering/server-core'
import { registerServerPlugins, registerStringLoaders } from '@hcengineering/server-pipeline'
import { buildStorageFromConfig, storageConfigFromEnv } from '@hcengineering/server-storage'
import serverToken from '@hcengineering/server-token'
import { join } from 'path'

import config from './config'
import { createServer, listen } from './server'
import { WorkspaceManager } from './workspace'

loadEnv()

setMetadata(serverToken.metadata.Secret, config.ServerSecret)
setMetadata(serverToken.metadata.Service, config.ServiceID)
setMetadata(serverClient.metadata.UserAgent, config.ServiceID)
setMetadata(serverClient.metadata.Endpoint, config.AccountsURL)

registerStringLoaders()
registerServerPlugins()

const ctx = initStatisticsContext(config.ServiceID, {
  factory: () =>
    createOpenTelemetryMetricsContext(
      config.ServiceID,
      {},
      {},
      newMetrics(),
      new SplitLogger(config.ServiceID, {
        root: join(process.cwd(), 'logs'),
        enableConsole: (process.env.ENABLE_CONSOLE ?? 'true') === 'true'
      })
    )
})

ctx.info('MCP Service started', { config })

const storageAdapter = buildStorageFromConfig(storageConfigFromEnv())
const workspaceManager = new WorkspaceManager(config, ctx, storageAdapter)
const app = createServer(config, workspaceManager, ctx)
const server = listen(app, config.Port, ctx)

const close = (): void => {
  server.close(() => {
    void Promise.all([workspaceManager.close(), storageAdapter.close()])
      .catch((err) => {
        ctx.error('Failed to close MCP resources', { error: err instanceof Error ? err.message : String(err) })
      })
      .finally(() => {
        process.exit()
      })
  })
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
process.on('uncaughtException', (err) => {
  ctx.error('Uncaught exception', { error: err instanceof Error ? err.message : String(err), stack: err.stack })
})
process.on('unhandledRejection', (err) => {
  ctx.error('Unhandled rejection', { error: err instanceof Error ? err.message : String(err) })
})
