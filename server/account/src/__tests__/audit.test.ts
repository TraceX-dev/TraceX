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

import {
  AccountRole,
  type AccountUuid,
  type MeasureContext,
  type Person,
  type WorkspaceUuid
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import { decodeToken, decodeTokenVerbose, type Token } from '@hcengineering/server-token'

import { auditAccountEvent, auditEmailHash } from '../audit'
import { guardGuestMethod } from '../guestAccess'
import { deleteWorkspace, login } from '../operations'
import { assignWorkspace, updateWorkspaceInfo } from '../serviceOperations'
import type { Account, AccountDB, AccountMethodHandler, SocialId, Workspace } from '../types'
import { hashWithSalt, wrap } from '../utils'

jest.mock('@hcengineering/server-token', () => ({
  ...jest.requireActual('@hcengineering/server-token'),
  decodeToken: jest.fn(),
  decodeTokenVerbose: jest.fn(),
  generateToken: jest.fn().mockReturnValue('private-issued-token')
}))

const actor = '3529632b-872d-43e0-8a31-6a54251593ce' as AccountUuid
const subject = '1b9fe950-2066-45b7-bd06-1f4b0b540975' as AccountUuid
const workspace = 'a8a3cc87-17ad-4f38-9008-6388ab1d36ee' as WorkspaceUuid
const decoded: Token = { account: actor, workspace, extra: { service: 'tool' } }
const logs: Pick<MeasureContext, 'info' | 'warn' | 'error'> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const ctx = logs as MeasureContext
const salt = Buffer.from('test-salt')
const subjectAccount: Partial<Account> = { uuid: subject, salt, hash: hashWithSalt('private-password', salt) }
const social: Partial<SocialId> = { personUuid: subject, verifiedOn: 1 }
const person: Partial<Person> = { uuid: subject, firstName: 'private-name', lastName: 'private-last-name' }
const workspaceRecord: Partial<Workspace> = { uuid: workspace }
const accountCollection: Partial<AccountDB['account']> = {
  findOne: jest.fn().mockResolvedValue(subjectAccount),
  update: jest.fn()
}
const personCollection: Partial<AccountDB['person']> = { findOne: jest.fn().mockResolvedValue(person) }
const socialCollection: Partial<AccountDB['socialId']> = { findOne: jest.fn().mockResolvedValue(social) }
const workspaceCollection: Partial<AccountDB['workspace']> = {
  findOne: jest.fn().mockResolvedValue(workspaceRecord),
  exists: jest.fn().mockResolvedValue(true),
  update: jest.fn()
}
const statusCollection: Partial<AccountDB['workspaceStatus']> = { update: jest.fn(), findOne: jest.fn() }
const db: Partial<AccountDB> = {
  account: accountCollection as AccountDB['account'],
  person: personCollection as AccountDB['person'],
  socialId: socialCollection as AccountDB['socialId'],
  workspace: workspaceCollection as AccountDB['workspace'],
  workspaceStatus: statusCollection as AccountDB['workspaceStatus'],
  getWorkspaceRole: jest.fn().mockResolvedValue(null),
  assignWorkspace: jest.fn(),
  updateWorkspaceRole: jest.fn()
}

function events (): Array<Record<string, unknown>> {
  return [logs.info, logs.warn, logs.error].flatMap((logger) =>
    (logger as jest.Mock).mock.calls.filter(([message]) => message === 'Audit event').map(([, fields]) => fields)
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(decodeToken as jest.Mock).mockReturnValue(decoded)
  ;(decodeTokenVerbose as jest.Mock).mockReturnValue(decoded)
  ;(db.getWorkspaceRole as jest.Mock).mockResolvedValue(null)
  ;(statusCollection.update as jest.Mock).mockResolvedValue(undefined)
  subjectAccount.tfaSecret = undefined
})

test('domain callers explicitly select fields and may use the actual target account', () => {
  auditAccountEvent(ctx, 'verified-token', { event: 'workspace.member.assign', targetAccountUuid: subject })
  expect(events()).toHaveLength(1)
  expect(events()[0]).toMatchObject({ actorAccountUuid: actor, targetAccountUuid: subject, workspaceUuid: workspace })
  expect(JSON.stringify(events())).not.toContain('verified-token')
})

test('public actions do not attribute an unrelated browser token', () => {
  auditAccountEvent(ctx, undefined, { event: 'account.signup', subjectAccountUuid: subject })
  expect(decodeToken).not.toHaveBeenCalled()
  expect(events()[0].actorAccountUuid).toBeUndefined()
  expect(events()[0].subjectAccountUuid).toBe(subject)
})

test.each([false, true])('login uses its actual account and distinguishes an MFA challenge (%s)', async (mfa) => {
  subjectAccount.tfaSecret = mfa ? 'private-mfa-secret' : undefined
  const result = await login(ctx, db as AccountDB, null, 'unrelated-browser-token', {
    email: 'private@example.com',
    password: 'private-password'
  })
  expect(result.account).toBe(subject)
  expect(decodeToken).not.toHaveBeenCalled()
  expect(events()).toHaveLength(1)
  expect(events()[0]).toMatchObject({
    event: 'account.login',
    subjectAccountUuid: subject,
    authenticationComplete: !mfa,
    tfaRequired: mfa
  })
  expect(events()[0].actorAccountUuid).toBeUndefined()
  expect(JSON.stringify(events())).not.toMatch(/private-|example.com|unrelated-browser-token/)
})

test('invalid token claims are never attributed', () => {
  ;(decodeToken as jest.Mock).mockImplementation(() => {
    throw new Error('invalid token')
  })
  auditAccountEvent(ctx, 'invalid-token', { event: 'account.rpc', outcome: 'denied' })
  expect(events()[0].actorAccountUuid).toBeUndefined()
})

test('assignment records the resolved recipient only when its role changes', async () => {
  const params: Parameters<typeof assignWorkspace>[4] = {
    email: 'private@example.com',
    workspaceUuid: workspace,
    role: AccountRole.User
  }
  await assignWorkspace(ctx, db as AccountDB, null, 'token', params)
  expect(db.assignWorkspace).toHaveBeenCalledWith(subject, workspace, AccountRole.User)
  expect(events()).toHaveLength(1)
  expect(events()[0]).toMatchObject({ event: 'workspace.member.assign', targetAccountUuid: subject })
  expect(JSON.stringify(events())).not.toContain(params.email)
  ;(db.getWorkspaceRole as jest.Mock).mockResolvedValue(AccountRole.User)
  await assignWorkspace(ctx, db as AccountDB, null, 'token', params)
  expect(events()).toHaveLength(1)
})

test('a failed mutation cannot produce a successful domain event', async () => {
  ;(db.getWorkspaceRole as jest.Mock).mockResolvedValue(AccountRole.Owner)
  const error = new Error('private database failure')
  ;(statusCollection.update as jest.Mock).mockRejectedValue(error)
  await expect(deleteWorkspace(ctx, db as AccountDB, null, 'token')).rejects.toBe(error)
  expect(events()).toHaveLength(0)
  ;(statusCollection.update as jest.Mock).mockResolvedValue(undefined)
  await deleteWorkspace(ctx, db as AccountDB, null, 'token')
  expect(events()).toHaveLength(1)
  expect(events()[0]).toMatchObject({ event: 'workspace.deletion.schedule', workspaceUuid: workspace })
})

test('worker progress stays silent and lifecycle changes emit one outcome', async () => {
  for (const event of ['ping', 'progress', 'create-done'] as const) {
    await updateWorkspaceInfo(ctx, db as AccountDB, null, 'token', {
      workspaceUuid: workspace,
      event,
      version: { major: 0, minor: 7, patch: 0 },
      progress: 100
    })
  }
  expect(events()).toHaveLength(1)
  expect(events()[0]).toMatchObject({ event: 'workspace.lifecycle.update', workspaceEvent: 'create-done' })
})

test('RPC failures are recorded once without inspecting parameters or status details', async () => {
  const error = new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, { secret: 'private-status' }))
  const operation = jest.fn().mockRejectedValue(error)
  const handler = wrap(operation, { guest: 'bypass' })
  const request: Record<string, unknown> = {
    id: 1,
    method: 'customMutation',
    params: { password: 'private-password' }
  }
  const response = await handler(ctx, db as AccountDB, null, request, 'token')
  expect(response.error.code).toBe(platform.status.Forbidden)
  expect(events()).toHaveLength(1)
  expect(events()[0]).toMatchObject({ event: 'account.rpc', method: 'customMutation', outcome: 'denied' })
  expect(JSON.stringify(events())).not.toMatch(/private-status|private-password/)
})

test('guest-policy denials are recorded without reaching the domain operation', async () => {
  const guest: Token = { account: actor, workspace, extra: {} }
  ;(decodeTokenVerbose as jest.Mock).mockReturnValue(guest)
  ;(db.getWorkspaceRole as jest.Mock).mockResolvedValue(AccountRole.Guest)
  const operation: jest.MockedFunction<AccountMethodHandler> = jest.fn()
  const handler = guardGuestMethod(operation)
  await handler(ctx, db as AccountDB, null, { id: 1, method: 'deleteWorkspace', params: {} }, 'token')
  expect(operation).not.toHaveBeenCalled()
  expect(events()).toHaveLength(1)
  expect(events()[0]).toMatchObject({ event: 'account.rpc', outcome: 'denied', method: 'deleteWorkspace' })
})

test('normalizes email hashes using the configured audit key', () => {
  const previous = process.env.AUDIT_HMAC_KEY
  process.env.AUDIT_HMAC_KEY = 'audit-test-key'
  try {
    expect(auditEmailHash(' User@Example.com ')).toBe(auditEmailHash('user@example.com'))
    expect(auditEmailHash('user@example.com')).not.toBe(auditEmailHash('other@example.com'))
    expect(auditEmailHash('user@example.com')).toMatch(/^[a-f0-9]{64}$/)
  } finally {
    if (previous === undefined) delete process.env.AUDIT_HMAC_KEY
    else process.env.AUDIT_HMAC_KEY = previous
  }
})
