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
  return [ctx.info, ctx.warn, ctx.error]
    .flatMap((logger) => {
      const mock = logger as jest.Mock
      return mock.mock.calls.map(([message, fields], index) => ({
        message,
        fields,
        order: mock.mock.invocationCallOrder[index]
      }))
    })
    .filter(({ message }) => message === 'Account audit event')
    .sort((a, b) => a.order - b.order)
    .map(({ fields }) => fields)
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

test.each(['join', 'signUpJoin'] as const)('%s ignores an unrelated browser token', async (method) => {
  const subject = '1b9fe950-2066-45b7-bd06-1f4b0b540975' as AccountUuid
  const response: Record<string, unknown> = { result: { account: subject, workspace } }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
  const methods = auditAccountMethods({ [method]: handler })
  expect(await invoke(methods[method], {}, 'unrelated-browser-token')).toBe(response)
  expect(decodeToken).not.toHaveBeenCalled()
  expect(handler.mock.calls[0][4]).toBe('unrelated-browser-token')
  expect(events()).toHaveLength(2)
  for (const event of events()) {
    expect(event.actorAccountUuid).toBeUndefined()
    expect(event.workspaceUuid).toBeUndefined()
  }
  expect(events()[1]).toMatchObject({
    subjectAccountUuid: subject,
    resultWorkspaceUuid: workspace,
    outcome: 'succeeded'
  })
})

test('identifies assignment recipients by normalized email hash without exporting their emails', async () => {
  const previousKey = process.env.ACCOUNT_AUDIT_HMAC_KEY
  process.env.ACCOUNT_AUDIT_HMAC_KEY = 'audit-test-key'
  try {
    const response: Record<string, unknown> = { result: undefined }
    const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
    const methods = auditAccountMethods({ assignWorkspace: handler })
    for (const email of [' User@Example.com ', 'user@example.com', 'other@example.com']) {
      expect(await invoke(methods.assignWorkspace, { email, workspaceUuid: workspace, role: AccountRole.User })).toBe(
        response
      )
    }
    expect(events()).toHaveLength(6)
    const targetEmailHash = events()[0].targetEmailHash
    expect(targetEmailHash).toMatch(/^[a-f0-9]{64}$/)
    expect(events()[2].targetEmailHash).toBe(targetEmailHash)
    expect(events()[4].targetEmailHash).toMatch(/^[a-f0-9]{64}$/)
    expect(events()[4].targetEmailHash).not.toBe(targetEmailHash)
    for (let index = 0; index < events().length; index += 2) {
      expect(events()[index]).toMatchObject({
        actorAccountUuid: actor,
        targetWorkspaceUuid: workspace,
        role: AccountRole.User
      })
      expect(events()[index + 1]).toMatchObject({
        targetEmailHash: events()[index].targetEmailHash,
        outcome: 'succeeded'
      })
    }
    expect(JSON.stringify(events())).not.toMatch(/example\.com|audit-test-key/)
  } finally {
    if (previousKey === undefined) delete process.env.ACCOUNT_AUDIT_HMAC_KEY
    else process.env.ACCOUNT_AUDIT_HMAC_KEY = previousKey
  }
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
  expect(events()).toHaveLength(6)
  expect(JSON.stringify(events())).not.toMatch(/private-seed|private-url|private-data/)
})

test.each([
  ['login', platform.status.AccountNotFound],
  ['login', platform.status.PasswordLoginLocked],
  ['validateOtp', platform.status.InvalidOtp],
  ['validateOtp', platform.status.OtpLocked],
  ['verify2fa', platform.status.InvalidOtp],
  ['enable2fa', platform.status.InvalidOtp],
  ['disable2fa', platform.status.InvalidOtp]
])('records credential denial for %s / %s at warning level', async (method, code) => {
  const failure: Record<string, unknown> = { error: new Status(Severity.ERROR, code, {}) }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(failure)
  const registered: Parameters<typeof auditAccountMethods>[0] = { [method]: handler }
  const methods = auditAccountMethods(registered)
  await invoke(methods[method as keyof typeof methods])
  expect(events()[1]).toMatchObject({ outcome: 'denied', errorCode: code })
  expect(ctx.warn).toHaveBeenCalledTimes(1)
  expect(ctx.error).not.toHaveBeenCalled()
})

test('keeps missing accounts in administrative operations classified as failures', async () => {
  const failure: Record<string, unknown> = { error: new Status(Severity.ERROR, platform.status.AccountNotFound, {}) }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(failure)
  const methods = auditAccountMethods({ deleteAccount: handler })
  await invoke(methods.deleteAccount)
  expect(events()[1].outcome).toBe('failed')
  expect(ctx.error).toHaveBeenCalledTimes(1)
})

test('correlates normalized login subjects with a keyed hash, without trusting a stale token', async () => {
  const previousKey = process.env.ACCOUNT_AUDIT_HMAC_KEY
  process.env.ACCOUNT_AUDIT_HMAC_KEY = 'audit-test-key'
  try {
    const failure: Record<string, unknown> = { error: new Status(Severity.ERROR, platform.status.AccountNotFound, {}) }
    const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(failure)
    const methods = auditAccountMethods({ login: handler })
    await invoke(methods.login, { email: ' User@Example.com ', password: 'private-password' }, 'stale-token')
    await invoke(methods.login, { email: 'user@example.com' })
    const firstHash = events()[0].subjectEmailHash
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/)
    expect(events()[1].subjectEmailHash).toBe(firstHash)
    expect(events()[2].subjectEmailHash).toBe(firstHash)
    process.env.ACCOUNT_AUDIT_HMAC_KEY = 'different-audit-test-key'
    await invoke(methods.login, { email: 'user@example.com' })
    expect(events()[4].subjectEmailHash).not.toBe(firstHash)
    expect(decodeToken).not.toHaveBeenCalled()
    expect(JSON.stringify(events())).not.toMatch(/example.com|audit-test-key|private-password|stale-token/)
  } finally {
    if (previousKey === undefined) delete process.env.ACCOUNT_AUDIT_HMAC_KEY
    else process.env.ACCOUNT_AUDIT_HMAC_KEY = previousKey
  }
})

test('uses the configured server secret as a domain-separated HMAC fallback and never falls back to plaintext', async () => {
  const previousKey = process.env.ACCOUNT_AUDIT_HMAC_KEY
  const previousSecret = process.env.SERVER_SECRET
  delete process.env.ACCOUNT_AUDIT_HMAC_KEY
  process.env.SERVER_SECRET = 'test-signing-secret'
  try {
    const response: Record<string, unknown> = { result: true }
    const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
    const methods = auditAccountMethods({ login: handler })
    await invoke(methods.login, { email: 'user@example.com' })
    expect(events()[0].subjectEmailHash).toMatch(/^[a-f0-9]{64}$/)
    delete process.env.SERVER_SECRET
    await invoke(methods.login, { email: 'user@example.com' })
    expect(events()[2].subjectEmailHash).toBeUndefined()
    expect(JSON.stringify(events())).not.toMatch(/user@example.com|test-signing-secret/)
  } finally {
    if (previousKey === undefined) delete process.env.ACCOUNT_AUDIT_HMAC_KEY
    else process.env.ACCOUNT_AUDIT_HMAC_KEY = previousKey
    if (previousSecret === undefined) delete process.env.SERVER_SECRET
    else process.env.SERVER_SECRET = previousSecret
  }
})

test('records social targets using the actual parameter names without display values', async () => {
  const response: Record<string, unknown> = { result: true }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
  const methods = auditAccountMethods({ addSocialIdToPerson: handler, updateSocialId: handler })
  await invoke(methods.addSocialIdToPerson, { person: actor, type: 'email', value: 'private@example.com' })
  await invoke(methods.updateSocialId, { personId: '123456', displayValue: 'private display name' })
  expect(events()[0].targetPersonUuid).toBe(actor)
  expect(events()[2].targetSocialId).toBe('123456')
  expect(JSON.stringify(events())).not.toMatch(/private@example.com|private display name/)
})

test('distinguishes a revoked invite hash from an API key ID and records social-key targets safely', async () => {
  const previousKey = process.env.ACCOUNT_AUDIT_HMAC_KEY
  process.env.ACCOUNT_AUDIT_HMAC_KEY = 'audit-test-key'
  try {
    const response: Record<string, unknown> = { result: true }
    const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
    const methods = auditAccountMethods({
      revokeInviteLink: handler,
      revokeApiKey: handler,
      updateWorkspaceRoleBySocialKey: handler
    })
    await invoke(methods.revokeInviteLink, { id: '123456' })
    expect(events()[0].inviteIdHash).toMatch(/^[a-f0-9]{64}$/)
    expect(events()[0].apiKeyId).toBeUndefined()
    await invoke(methods.revokeApiKey, { id: 'safe-api-id' })
    expect(events()[2].apiKeyId).toBe('safe-api-id')
    await invoke(methods.updateWorkspaceRoleBySocialKey, {
      socialKey: 'email:private@example.com',
      targetRole: AccountRole.Owner
    })
    expect(events()[4].targetSocialKeyHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(events())).not.toMatch(/123456|private@example.com/)
  } finally {
    if (previousKey === undefined) delete process.env.ACCOUNT_AUDIT_HMAC_KEY
    else process.env.ACCOUNT_AUDIT_HMAC_KEY = previousKey
  }
})

test('uses one outcome event for service secret reads, including denials', async () => {
  const response: Record<string, unknown> = { result: { secret: 'private-secret' } }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
  const methods = auditAccountMethods({ getIntegrationSecret: handler, listIntegrationsSecrets: handler })
  await invoke(methods.getIntegrationSecret)
  expect(events()).toHaveLength(1)
  expect(events()[0].outcome).toBe('succeeded')
  const denial: Record<string, unknown> = { error: new Status(Severity.ERROR, platform.status.Forbidden, {}) }
  handler.mockResolvedValue(denial)
  await invoke(methods.listIntegrationsSecrets)
  expect(events()).toHaveLength(2)
  expect(events()[1].outcome).toBe('denied')
  expect(JSON.stringify(events())).not.toContain('private-secret')
})

test('does not assign an unknown service to ordinary user tokens', async () => {
  const userToken: Token = { account: actor, workspace, extra: {} }
  ;(decodeToken as jest.Mock).mockReturnValue(userToken)
  const response: Record<string, unknown> = { result: true }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
  const methods = auditAccountMethods({ changeUsername: handler })
  await invoke(methods.changeUsername)
  expect(events()[0].actorAccountUuid).toBe(actor)
  expect(events()[0].actorService).toBeUndefined()
})

test('audits token issue, exchange and assistant refresh without exporting tokens or names', async () => {
  const response: Record<string, unknown> = { result: { token: 'private-issued-token', workspace } }
  const handler: jest.MockedFunction<AccountMethodHandler> = jest.fn().mockResolvedValue(response)
  const methods = auditAccountMethods({
    selectWorkspace: handler,
    exchangeGuestToken: handler,
    refreshHulyAssistantToken: handler,
    changeUsername: handler
  })
  await invoke(methods.selectWorkspace, { workspaceUrl: 'test-workspace', kind: 'external' })
  expect(events()[1].resultWorkspaceUuid).toBe(workspace)
  await invoke(methods.exchangeGuestToken)
  await invoke(methods.refreshHulyAssistantToken)
  await invoke(methods.changeUsername, { first: 'private-name', last: 'private-last-name' })
  expect(events()).toHaveLength(8)
  expect(JSON.stringify(events())).not.toMatch(/private-issued-token|private-name|private-last-name/)
})
