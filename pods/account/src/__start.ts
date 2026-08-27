//
// Copyright © 2023 Hardcore Engineering Inc.
//
import { serveAccount } from '@hcengineering/account-service'
import { setSessionRevokeNotifier } from '@hcengineering/account'
import { Analytics } from '@hcengineering/analytics'
import { configureAnalytics, createOpenTelemetryMetricsContext, SplitLogger } from '@hcengineering/analytics-service'
import { newMetrics, type WorkspaceUuid } from '@hcengineering/core'
import { getPlatformQueue } from '@hcengineering/kafka'
import {
  initStatisticsContext,
  loadBrandingMap,
  QueueTopic,
  type QueueWorkspaceMessage,
  workspaceEvents
} from '@hcengineering/server-core'
import { join } from 'path'

configureAnalytics('account', process.env.VERSION ?? '0.7.0')
Analytics.setTag('application', 'account')

const metricsContext = initStatisticsContext('account', {
  factory: () =>
    createOpenTelemetryMetricsContext(
      'account',
      {},
      {},
      newMetrics(),
      new SplitLogger('account', {
        root: join(process.cwd(), 'logs'),
        enableConsole: (process.env.ENABLE_CONSOLE ?? 'true') === 'true'
      })
    )
})

const brandingPath = process.env.BRANDING_PATH

if (process.env.QUEUE_CONFIG !== undefined) {
  try {
    const queue = getPlatformQueue('account')
    const wsProducer = queue.getProducer<QueueWorkspaceMessage>(
      metricsContext.newChild('ws-queue', {}),
      QueueTopic.Workspace
    )
    setSessionRevokeNotifier(async ({ accountUuid, workspaceUuid, sessionId }) => {
      const key = (workspaceUuid ?? accountUuid) as unknown as WorkspaceUuid
      await wsProducer.send(metricsContext, key, [workspaceEvents.sessionRevoked(sessionId)])
    })
  } catch (err) {
    metricsContext.error('Failed to wire session revoke notifier', { err })
  }
}

serveAccount(metricsContext, loadBrandingMap(brandingPath), () => {})
