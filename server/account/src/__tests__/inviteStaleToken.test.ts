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

/**
 * Reproduces "not authorized" on the workspace invite page.
 *
 * The browser account client sends requests with `credentials: 'include'`, so a leftover
 * auth cookie is attached to every account RPC, even to public ones like `join`/`signUpJoin`.
 * If that cookie was signed with another secret (other environment, rotated SERVER_SECRET),
 * the invite page methods must still work: they do not need a token at all.
 *
 * These tests use the REAL token implementation (no mocks of server-token): the "stale" token
 * is signed with a different secret, exactly like in the production logs
 * ("Failed to verify token" / "Signature verification failed").
 */

import { AccountRole, type AccountUuid, type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'
import platform, { setMetadata } from '@hcengineering/platform'
import serverToken, { generateToken } from '@hcengineering/server-token'

import { getMethods } from '../operations'
import type { AccountDB } from '../types'

const CURRENT_SECRET = 'current-env-secret'
const OTHER_SECRET = 'other-env-secret'

const accountUuid = '3b289262-e54f-4ec4-a838-18c2cdf3840b' as AccountUuid
const workspaceUuid = 'e6fd26ea-19d4-466b-abe9-3620dd4f09e6' as WorkspaceUuid
const inviteId = '5571590115058863480'

const workspace = { uuid: workspaceUuid, url: 'test-ws', name: 'Test workspace' }
const invite = {
  id: inviteId,
  workspaceUuid,
  expiresOn: -1,
  remainingUses: -1,
  role: AccountRole.User,
  revokedOn: null,
  email: null,
  autoJoin: null
}

const ctx = {
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  with: jest.fn(async (_n: string, _p: any, op: (c: any) => any) => await op(ctx))
} as unknown as MeasureContext

function makeDb (): AccountDB {
  return {
    invite: { findOne: jest.fn(async (q: any) => (q.id === inviteId ? invite : null)) },
    workspace: { findOne: jest.fn(async () => workspace) },
    socialId: { findOne: jest.fn(async () => null) },
    account: { findOne: jest.fn(async () => null) },
    person: { findOne: jest.fn(async () => null) },
    getWorkspaceRole: jest.fn(async () => null),
    getWorkspaceRoles: jest.fn(async () => new Map())
  } as unknown as AccountDB
}

/** Token as it is left in the browser cookie by another environment / before secret rotation. */
function staleCookieToken (): string {
  return generateToken(accountUuid, undefined, { authMethod: 'otp' }, OTHER_SECRET)
}

/** Token issued by this environment, i.e. what the user gets after re-login on /login. */
function freshToken (): string {
  return generateToken(accountUuid, undefined, { authMethod: 'otp' })
}

const methods = getMethods(true)

async function call (method: string, params: Record<string, unknown>, token: string | undefined): Promise<any> {
  const handler = (methods as any)[method]
  if (handler === undefined) throw new Error(`Missing account method: ${method}`)
  return await handler(ctx, makeDb(), null, { id: 1, method, params }, token)
}

function errorCode (res: any): string | undefined {
  return res?.error?.code
}

describe('invite page with a stale auth cookie (signed with another secret)', () => {
  beforeAll(() => {
    setMetadata(serverToken.metadata.Secret, CURRENT_SECRET)
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('sanity: the stale token really fails signature verification here', async () => {
    // checkJoin requires a valid session, so Unauthorized is the correct answer for it.
    const res = await call('checkJoin', { inviteId }, staleCookieToken())
    expect(errorCode(res)).toBe(platform.status.Unauthorized)
  })

  describe('getInviteInfo (workspace name in the form caption)', () => {
    test('works without a token', async () => {
      const res = await call('getInviteInfo', { inviteId }, undefined)
      expect(res.result).toEqual({ workspaceName: workspace.name })
    })

    test('works with a fresh token (state after re-login workaround)', async () => {
      const res = await call('getInviteInfo', { inviteId }, freshToken())
      expect(res.result).toEqual({ workspaceName: workspace.name })
    })

    test('must not fail with Unauthorized because of a stale cookie', async () => {
      const res = await call('getInviteInfo', { inviteId }, staleCookieToken())
      expect(errorCode(res)).not.toBe(platform.status.Unauthorized)
      expect(res.result).toEqual({ workspaceName: workspace.name })
    })
  })

  describe('signUpJoin ("Sign up and join" button)', () => {
    // An unknown invite makes the method answer Forbidden from inside the business logic.
    // Getting Forbidden proves the request reached the method; Unauthorized means wrap() rejected it.
    const params = {
      email: 'new.user@example.com',
      password: 'Passw0rd!',
      first: 'New',
      last: 'User',
      inviteId: 'unknown-invite',
      workspaceUrl: ''
    }

    test('reaches the method without a token', async () => {
      const res = await call('signUpJoin', params, undefined)
      expect(errorCode(res)).toBe(platform.status.Forbidden)
    })

    test('must reach the method with a stale cookie instead of Unauthorized', async () => {
      const res = await call('signUpJoin', params, staleCookieToken())
      expect(errorCode(res)).not.toBe(platform.status.Unauthorized)
      expect(errorCode(res)).toBe(platform.status.Forbidden)
    })
  })

  describe('join ("Log in and join" button)', () => {
    // Valid invite, but no such email: login() answers AccountNotFound from inside the method.
    const params = { email: 'someone@example.com', password: 'Passw0rd!', inviteId, workspaceUrl: '' }

    test('reaches the method without a token', async () => {
      const res = await call('join', params, undefined)
      expect(errorCode(res)).toBe(platform.status.AccountNotFound)
    })

    test('must reach the method with a stale cookie instead of Unauthorized', async () => {
      const res = await call('join', params, staleCookieToken())
      expect(errorCode(res)).not.toBe(platform.status.Unauthorized)
      expect(errorCode(res)).toBe(platform.status.AccountNotFound)
    })
  })

  describe('checkAutoJoin (auto-join guest links)', () => {
    const autoJoinInvite = { ...invite, autoJoin: true, role: AccountRole.Guest, email: 'k@example.com' }

    function autoJoinDb (): AccountDB {
      const db = makeDb() as any
      db.invite.findOne = jest.fn(async () => autoJoinInvite)
      db.socialId.findOne = jest.fn(async () => ({ _id: 's1', personUuid: accountUuid, value: 'k@example.com' }))
      db.account.findOne = jest.fn(async () => ({ uuid: accountUuid, automatic: false }))
      db.person.findOne = jest.fn(async () => ({ uuid: accountUuid, firstName: 'K', lastName: '' }))
      return db
    }

    async function callAutoJoin (token: string | undefined): Promise<any> {
      return await (methods as any).checkAutoJoin(ctx, autoJoinDb(), null, { id: 1, params: { inviteId } }, token)
    }

    test('without a token asks the existing user to log in', async () => {
      const res = await callAutoJoin(undefined)
      expect(res.result).toMatchObject({ workspace: workspaceUuid, email: 'k@example.com' })
    })

    test('a stale cookie must be treated as "no token" (ask to log in), not Unauthorized', async () => {
      const res = await callAutoJoin(staleCookieToken())
      expect(errorCode(res)).not.toBe(platform.status.Unauthorized)
      expect(res.result).toMatchObject({ workspace: workspaceUuid, email: 'k@example.com' })
    })
  })
})

describe('join with an existing account that has no password (OTP / provider sign-up)', () => {
  // Second scenario from the logs: signUpJoin -> AccountAlreadyExists, then join -> AccountNotFound.
  // The account exists, but the invite form only offers password login, and login() reports a
  // missing/wrong password as AccountNotFound, so the user cannot tell what to do.
  beforeAll(() => {
    setMetadata(serverToken.metadata.Secret, CURRENT_SECRET)
  })

  function passwordlessAccountDb (): AccountDB {
    const db = makeDb() as any
    const socialId = { _id: 's1', personUuid: accountUuid, value: 'k@example.com', verifiedOn: Date.now() }
    db.socialId.findOne = jest.fn(async () => socialId)
    db.account.findOne = jest.fn(async () => ({ uuid: accountUuid, hash: null, salt: null }))
    db.person.findOne = jest.fn(async () => ({ uuid: accountUuid, firstName: 'K', lastName: '' }))
    db.account.update = jest.fn()
    return db
  }

  async function run (method: string, params: Record<string, unknown>): Promise<any> {
    return await (methods as any)[method](ctx, passwordlessAccountDb(), null, { id: 1, params }, undefined)
  }

  test('signUpJoin says the account already exists', async () => {
    const res = await run('signUpJoin', {
      email: 'k@example.com',
      password: 'Passw0rd!',
      first: 'K',
      inviteId,
      workspaceUrl: ''
    })
    expect(errorCode(res)).toBe(platform.status.AccountAlreadyExists)
  })

  test('join then says AccountNotFound for the same email (password not set)', async () => {
    const res = await run('join', { email: 'k@example.com', password: 'Passw0rd!', inviteId, workspaceUrl: '' })
    // Documents current behaviour: indistinguishable from "no such account".
    expect(errorCode(res)).toBe(platform.status.AccountNotFound)
  })
})
