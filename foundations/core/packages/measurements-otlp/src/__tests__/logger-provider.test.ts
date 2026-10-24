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

import { context, metrics, trace } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { BatchLogRecordProcessor, type LoggerProvider } from '@opentelemetry/sdk-logs'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { createOpenTelemetryMetricsContext, initOpenTelemetrySDK, reportOTEL, reportOTELError } from '../telemetry'

jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: () => []
}))

it('uses the SDK logger provider for reporting and contexts, exporting and shutting down once', async () => {
  const previousEnv = { ...process.env }
  const previousHandlers = new Set(process.listeners('SIGTERM'))
  const bodies: unknown[] = []
  const exportLogs = jest.spyOn(OTLPLogExporter.prototype, 'export').mockImplementation((records, onResult) => {
    bodies.push(...records.map((record) => record.body))
    onResult({ code: 0 })
  })
  jest.spyOn(OTLPMetricExporter.prototype, 'export').mockImplementation((_records, onResult) => {
    onResult({ code: 0 })
  })
  const start = jest.spyOn(NodeSDK.prototype, 'start')
  const shutdown = jest.spyOn(BatchLogRecordProcessor.prototype, 'shutdown')
  jest.spyOn(console, 'log').mockImplementation(() => {})
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
  process.env.OTEL_NODE_RESOURCE_DETECTORS = 'none'
  process.env.OTEL_LOGGER_ENABLED = 'true'
  delete process.env.OTEL_SDK_DISABLED

  try {
    expect(initOpenTelemetrySDK('logger-test', '1.0')).toBe(true)
    expect(initOpenTelemetrySDK('logger-test', '1.0')).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
    const provider = logs.getLoggerProvider() as LoggerProvider
    const getLogger = jest.spyOn(provider, 'getLogger')
    reportOTEL('info', 'info message', Date.now())
    reportOTELError(new Error('error message'))
    createOpenTelemetryMetricsContext('logger-test', {}, undefined, undefined, undefined, '1.0')
    expect(getLogger).toHaveBeenCalledTimes(3)
    expect(getLogger).toHaveBeenCalledWith('logger-test', '1.0')
    await provider.forceFlush()
    expect(bodies).toEqual(['info message', 'error message'])
    expect(exportLogs).toHaveBeenCalledTimes(1)
  } finally {
    const sdk = start.mock.contexts[0] as NodeSDK | undefined
    if (sdk !== undefined) {
      await sdk.shutdown()
    }
    for (const handler of process.listeners('SIGTERM')) {
      if (!previousHandlers.has(handler)) process.removeListener('SIGTERM', handler)
    }
    logs.disable()
    trace.disable()
    metrics.disable()
    context.disable()
    process.env = previousEnv
    jest.restoreAllMocks()
  }
  expect(shutdown).toHaveBeenCalledTimes(1)
})
