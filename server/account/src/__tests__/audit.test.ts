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

import { AccountRole, type AccountUuid, type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import { decodeToken, decodeTokenVerbose, type Token } from '@hcengineering/server-token'

import { auditAccountMethods } from '../audit'
import { guardGuestMethod } from '../guestAccess'
import type { AccountDB, AccountMethodHandler } from '../types'

jest.mock('@hcengineering/server-token', () => ({ decodeToken: jest.fn(), decodeTokenVerbose: jest.fn() }))

const actor = '3529632b-872d-43e0-8a31-6a54251593ce' as AccountUuid
const workspace = 'a8a3cc87-17ad-4f38-9008-6388ab1d36ee' as WorkspaceUuid
const decoded: Token = { account: actor, workspace, extra: { service: 'tool', admin: 'true' } }
const ctx: Pick<MeasureContext, 'info' | 'warn' | 'error'> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}
const db: Partial<AccountDB> = {}

async function invoke (
  handler: AccountMethodHandler | undefined,
  parameters: Record<string, unknown> = {},
  token: string | undefined = 'verified-token'
): Promise<unknown> {
  if (handler === undefined) throw new Error('Missing audited method')
  const request: Record<string, unknown> = { id: 1, params: parameters }
  return await handler(ctx as MeasureContext, db as AccountDB, null, request, token)
}

function events (): Array<Record<string, unknown>> {
  return [ctx.info, ctx.warn, ctx.error].flatMap((logger) =>
    (logger as jest.Mock).mock.calls
      .filter(([message]) => message === 'Account audit event')
      .map(([, fields]) => fields)
  )
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(decodeToken as jest.Mock).mockReturnValue(decoded)
  ;(decodeTokenVerbose as jest.Mock).mockReturnValue(decoded)
})

test('records a deletion request and outcome with verified identity and distinct event IDs', async () => {
  const response: Record<string, unknown> = { id: 1, result: undefined }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
  const methods = auditAccountMethods({ deleteWorkspace: handler })
  expect(await invoke(methods.deleteWorkspace, { password: 'secret-password', token: 'secret-token' })).toBe(response)
  expect(handler).toHaveBeenCalledTimes(1)
  expect(events()).toHaveLength(2)
  expect(events()[0]).toMatchObject({
    event: 'workspace.deletion.schedule',
    outcome: 'requested',
    actorAccountUuid: actor,
    workspaceUuid: workspace,
    actorService: 'tool',
    actorIsAdmin: true
  })
  expect(events()[1]).toMatchObject({ outcome: 'succeeded', operationId: events()[0].operationId })
  expect(events()[0].eventId).not.toBe(events()[1].eventId)
  expect(JSON.stringify(events())).not.toMatch(/secret-password|secret-token|verified-token/)
})

test('includes guest-policy denials without invoking the protected operation', async () => {
  const guest: Token = { account: actor, workspace, extra: {} }
  ;(decodeTokenVerbose as jest.Mock).mockReturnValue(guest)
  const guestDb: Partial<AccountDB> = { getWorkspaceRole: jest.fn().mockResolvedValue(AccountRole.Guest) }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn()
  const methods = auditAccountMethods({ deleteWorkspace: guardGuestMethod(handler) })
  const request: Record<string, unknown> = { id: 1, method: 'deleteWorkspace', params: {} }
  const response = await methods.deleteWorkspace?.(ctx as MeasureContext, guestDb as AccountDB, null, request, 'token')
  expect(response.error.code).toBe(platform.status.Forbidden)
  expect(handler).not.toHaveBeenCalled()
  expect(events()[1]).toMatchObject({ outcome: 'denied', errorCode: platform.status.Forbidden })
})

test('keeps failure status parameters and raw errors out of audit records', async () => {
  const failure: Record<string, unknown> = {
    id: 1,
    error: new Status(Severity.ERROR, platform.status.Forbidden, { secret: 'private-status' })
  }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(failure)
  const methods = auditAccountMethods({ changePassword: handler })
  expect(await invoke(methods.changePassword)).toBe(failure)
  expect(events()[1]).toMatchObject({ outcome: 'denied', errorCode: platform.status.Forbidden })
  expect(JSON.stringify(events())).not.toContain('private-status')
})

test('preserves thrown errors and does not log their message', async () => {
  const error = new PlatformError(new Status(Severity.ERROR, platform.status.BadRequest, { secret: 'private-error' }))
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockRejectedValue(error)
  const methods = auditAccountMethods({ deleteAccount: handler })
  await expect(invoke(methods.deleteAccount)).rejects.toBe(error)
  expect(events()[1]).toMatchObject({ outcome: 'failed', errorCode: platform.status.BadRequest })
  expect(JSON.stringify(events())).not.toContain('private-error')
})

test('ignores stale tokens on public login and records an MFA challenge without exporting the result', async () => {
  const result: Record<string, unknown> = {
    account: actor,
    token: 'mfa-token',
    tfaRequired: true,
    name: 'private-name'
  }
  const response: Record<string, unknown> = { id: 1, result }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
  const methods = auditAccountMethods({ login: handler })
  expect(
    await invoke(methods.login, { email: 'private@email.test', password: 'private-password' }, 'stale-token')
  ).toBe(response)
  expect(decodeToken).not.toHaveBeenCalled()
  expect(events()[0].actorAccountUuid).toBeUndefined()
  expect(events()[1]).toMatchObject({
    subjectAccountUuid: actor,
    tfaRequired: true,
    authenticationComplete: false,
    outcome: 'succeeded'
  })
  expect(JSON.stringify(events())).not.toMatch(/mfa-token|private-name|private@email|private-password|stale-token/)
})

test('never attributes invalid token claims', async () => {
  ;(decodeToken as jest.Mock).mockImplementation(() => {
    throw new Error('invalid token')
  })
  const handler: jest.MockedFunction<AccountMethodHandler> = jest
    .fn()
    .mockResolvedValue({ error: new Status(Severity.ERROR, platform.status.Unauthorized, {}) })
  const methods = auditAccountMethods({ deleteWorkspace: handler })
  await invoke(methods.deleteWorkspace)
  expect(events()[0].actorAccountUuid).toBeUndefined()
  expect(events()[1].outcome).toBe('denied')
})

test('records only allowed integration identifiers and the API key ID', async () => {
  const integration: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue({ result: undefined })
  const apiKey: jest.MockedFunction<AccountMethodHandler> = jest
    .fn()
    .mockResolvedValue({ result: { apiKey: { id: 'safe-id', keySuffix: 'private-suffix' }, key: 'private-key' } })
  const methods = auditAccountMethods({ addIntegrationSecret: integration, createApiKey: apiKey })
  await invoke(methods.addIntegrationSecret, {
    workspaceUuid: workspace,
    kind: 'github',
    secret: 'private-secret',
    data: { token: 'private-token' },
    key: 'private-key-name'
  })
  await invoke(methods.createApiKey)
  expect(events()[0]).toMatchObject({ targetWorkspaceUuid: workspace, kind: 'github' })
  expect(events()[3].apiKeyId).toBe('safe-id')
  expect(JSON.stringify(events())).not.toMatch(/private-/)
})

test('bounds batch targets and distinguishes an operation that was not applied', async () => {
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue({ result: false })
  const methods = auditAccountMethods({ performWorkspaceOperation: handler })
  await invoke(methods.performWorkspaceOperation, {
    workspaceId: Array(101).fill(workspace),
    event: 'delete',
    params: ['private-parameter']
  })
  expect(events()[0].targetWorkspaceUuid).toHaveLength(100)
  expect(events()[0].targetWorkspaceUuidCount).toBe(101)
  expect(events()[1].outcome).toBe('not-applied')
  expect(JSON.stringify(events())).not.toContain('private-parameter')
})

test('leaves reads and lifecycle progress uninstrumented', async () => {
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue({ result: true })
  const methods = auditAccountMethods({ getWorkspaceInfo: handler, updateWorkspaceInfo: handler })
  expect(methods.getWorkspaceInfo).toBe(handler)
  await invoke(methods.updateWorkspaceInfo, { event: 'ping' })
  await invoke(methods.updateWorkspaceInfo, { event: 'progress' })
  expect(events()).toHaveLength(0)
  await invoke(methods.updateWorkspaceInfo, { event: 'create-done', workspaceUuid: workspace })
  expect(events()[1]).toMatchObject({ workspaceEvent: 'create-done', outcome: 'succeeded' })
})

test('logging failures cannot change successful or failed business outcomes', async () => {
  ;(ctx.info as jest.Mock).mockImplementation(() => {
    throw new Error('logger unavailable')
  })
  ;(ctx.error as jest.Mock).mockImplementation(() => {
    throw new Error('logger unavailable')
  })
  const response: Record<string, unknown> = { result: true }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
  const methods = auditAccountMethods({ deleteWorkspace: handler })
  expect(await invoke(methods.deleteWorkspace)).toBe(response)
  const error = new Error('original error')
  handler.mockRejectedValue(error)
  await expect(invoke(methods.deleteWorkspace)).rejects.toBe(error)
})

test('concurrent calls have independent operation identities', async () => {
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue({ result: true })
  const methods = auditAccountMethods({ deleteWorkspace: handler })
  await Promise.all([invoke(methods.deleteWorkspace), invoke(methods.deleteWorkspace)])
  const requested = events().filter((event) => event.outcome === 'requested')
  expect(requested[0].operationId).not.toBe(requested[1].operationId)
  for (const event of requested) {
    expect(events().filter((item) => item.operationId === event.operationId)).toHaveLength(2)
  }
})

test('audits privileged secret reads without logging returned seeds, URLs or secret values', async () => {
  const response: Record<string, unknown> = {
    id: 1,
    result: { secret: 'private-seed', url: 'otpauth://private-url', data: 'private-data' }
  }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
  const registered: Parameters<typeof auditAccountMethods>[0] = {
    generate2faSecret: handler,
    getMailboxSecret: handler,
    getIntegrationSecret: handler,
    listIntegrationsSecrets: handler
  }
  const methods = auditAccountMethods(registered)
  await invoke(methods.generate2faSecret)
  await invoke(methods.getMailboxSecret)
  await invoke(methods.getIntegrationSecret)
  await invoke(methods.listIntegrationsSecrets)
  expect(events()).toHaveLength(8)
  expect(JSON.stringify(events())).not.toMatch(/private-seed|private-url|private-data/)
})
