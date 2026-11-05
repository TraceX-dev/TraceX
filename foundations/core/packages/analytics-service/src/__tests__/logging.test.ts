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

import { once } from 'events'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'

import { SplitLogger } from '../logging'

let root: string
const loggers: SplitLogger[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tracex-audit-logs-'))
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

async function closeLoggers (): Promise<void> {
  for (const logger of loggers.splice(0).reverse()) {
    const finished = logger.logger.transports
      .filter((transport): transport is DailyRotateFile => transport instanceof DailyRotateFile)
      .map(async (transport) => await once(transport, 'finish'))
    await logger.close()
    await Promise.all(finished)
  }
}

afterEach(async () => {
  try {
    await closeLoggers()
  } finally {
    jest.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  }
})

async function contents (prefix: string): Promise<string> {
  const files = (await readdir(root)).filter((file) => file.startsWith(prefix) && file.endsWith('.log'))
  return (await Promise.all(files.map(async (file) => await readFile(join(root, file), 'utf8')))).join('\n')
}

test.each([false, true])('separates audit files from ordinary files and console with pretty=%s', async (pretty) => {
  const consoleLog = jest.spyOn(winston.transports.Console.prototype, 'log').mockImplementation((_info, callback) => {
    if (typeof callback === 'function') callback()
  })
  const logger = new SplitLogger('account', { root, pretty, enableConsole: true })
  loggers.push(logger)
  consoleLog.mockClear()

  logger.info('technical-info')
  logger.warn('technical-warning', { audit: false })
  logger.error('technical-error')
  logger.info('audit-success', { audit: true, eventId: 'event-1', outcome: 'succeeded' })
  logger.warn('audit-denial', { audit: true, eventId: 'event-2', outcome: 'denied' })
  logger.error('audit-failure', { audit: true, eventId: 'event-3', outcome: 'failed' })
  await closeLoggers()

  const combined = await contents('account-combined-')
  const errors = await contents('account-error-')
  const audit = await contents('account-audit-')
  expect(combined).toMatch(/technical-info/)
  expect(combined).toMatch(/technical-warning/)
  expect(combined).toMatch(/technical-error/)
  expect(errors).toContain('technical-error')
  expect(errors).not.toMatch(/technical-info|technical-warning/)
  expect(combined + errors).not.toMatch(/audit-success|audit-denial|audit-failure/)
  expect(audit).not.toContain('technical-')
  const records: Array<Record<string, unknown>> = audit
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(records).toHaveLength(3)
  expect(records).toEqual([
    expect.objectContaining({ audit: true, eventId: 'event-1', outcome: 'succeeded', level: 'info' }),
    expect.objectContaining({ audit: true, eventId: 'event-2', outcome: 'denied', level: 'warn' }),
    expect.objectContaining({ audit: true, eventId: 'event-3', outcome: 'failed', level: 'error' })
  ])
  expect(consoleLog).toHaveBeenCalledTimes(3)
  expect(JSON.stringify(consoleLog.mock.calls)).not.toMatch(/audit-success|audit-denial|audit-failure/)
})

test('filters audit records forwarded by child loggers without losing their fields', async () => {
  const consoleLog = jest.spyOn(winston.transports.Console.prototype, 'log').mockImplementation((_info, callback) => {
    if (typeof callback === 'function') callback()
  })
  const parent = new SplitLogger('account', { root, enableConsole: true })
  const child = parent.childLogger('worker', { enableConsole: 'true', workspaceUuid: 'workspace-1' })
  loggers.push(parent, child as SplitLogger)
  consoleLog.mockClear()

  child.info('child-technical')
  child.info('child-audit-success', { audit: true, operationId: 'operation-1' })
  child.warn('child-audit-denial', { audit: true, operationId: 'operation-2' })
  child.error('child-audit-failure', { audit: true, operationId: 'operation-3' })
  await closeLoggers()

  for (const name of ['account', 'worker']) {
    expect(await contents(`${name}-combined-`)).toContain('child-technical')
    expect((await contents(`${name}-combined-`)) + (await contents(`${name}-error-`))).not.toContain('child-audit-')
    expect(await contents(`${name}-audit-`)).toContain('child-audit-success')
    expect(await contents(`${name}-audit-`)).toContain('child-audit-denial')
    expect(await contents(`${name}-audit-`)).toContain('child-audit-failure')
  }
  expect(await contents('account-audit-')).toContain('"workspaceUuid":"workspace-1"')
  expect(JSON.stringify(consoleLog.mock.calls)).not.toContain('child-audit-')
})
