// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { getClient } from '@hcengineering/account-client'
import type { AccountUuid } from '@hcengineering/core'
import type { TraceXAuthInfo } from '../auth'
import { createPackageAuthorizer } from '../package-authoring-access'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))

const account = 'manager-account' as AccountUuid
const auth: TraceXAuthInfo = {
  token: 'opaque',
  clientId: 'client',
  scopes: ['tracex'],
  resource: new URL('https://tracex.test/mcp'),
  extra: { account, accountToken: 'private-account-token', connectionId: 'connection', workspaceId: 'workspace' }
}
const resolveAccountByEmail = jest.fn()
const getClientMock = jest.mocked(getClient)

beforeEach(() => {
  getClientMock.mockReset()
  resolveAccountByEmail.mockReset()
  const client: Partial<ReturnType<typeof getClient>> = { resolveAccountByEmail }
  getClientMock.mockReturnValue(client as ReturnType<typeof getClient>)
})

describe('package authoring allowlists', () => {
  it('denies empty allowlists without contacting the account service', async () => {
    const authorize = createPackageAuthorizer({ AccountsURL: 'https://accounts.test' })
    expect(await authorize(auth)).toBe(false)
    expect(getClientMock).not.toHaveBeenCalled()
  })

  it('preserves explicit UUID access without depending on email resolution', async () => {
    const authorize = createPackageAuthorizer({
      AccountsURL: 'https://accounts.test',
      PackageAuthorAccounts: [account],
      PackageAuthorEmails: ['manager@example.com']
    })
    expect(await authorize(auth)).toBe(true)
    expect(getClientMock).not.toHaveBeenCalled()
  })

  it('resolves a normalized configured email through the trusted authority using the authenticated session', async () => {
    resolveAccountByEmail.mockResolvedValue(account)
    const authorize = createPackageAuthorizer({
      AccountsURL: 'https://accounts.test',
      PackageAuthorEmails: ['  Manager@Example.COM  ']
    })
    expect(await authorize(auth)).toBe(true)
    expect(getClientMock).toHaveBeenCalledWith('https://accounts.test', 'private-account-token')
    expect(resolveAccountByEmail).toHaveBeenCalledWith('manager@example.com')
  })

  it.each([undefined, 'another-account'])(
    'does not grant access when the verified email resolves to %s',
    async (resolved) => {
      resolveAccountByEmail.mockResolvedValue(resolved)
      const authorize = createPackageAuthorizer({
        AccountsURL: 'https://accounts.test',
        PackageAuthorEmails: ['manager@example.com']
      })
      expect(await authorize(auth)).toBe(false)
    }
  )

  it('checks each distinct configured address until one matches the authenticated account', async () => {
    resolveAccountByEmail.mockResolvedValueOnce(undefined).mockResolvedValueOnce(account)
    const authorize = createPackageAuthorizer({
      AccountsURL: 'https://accounts.test',
      PackageAuthorEmails: ['other@example.com', ' Other@Example.com ', '', 'manager@example.com']
    })
    expect(await authorize(auth)).toBe(true)
    expect(resolveAccountByEmail.mock.calls).toEqual([['other@example.com'], ['manager@example.com']])
  })

  it('rechecks email ownership on every call so removed or reassigned emails stop granting access', async () => {
    resolveAccountByEmail.mockResolvedValueOnce(account).mockResolvedValueOnce(undefined)
    const authorize = createPackageAuthorizer({
      AccountsURL: 'https://accounts.test',
      PackageAuthorEmails: ['manager@example.com']
    })
    expect(await authorize(auth)).toBe(true)
    expect(await authorize(auth)).toBe(false)
    expect(resolveAccountByEmail).toHaveBeenCalledTimes(2)
  })

  it('does not authorize when the account service fails', async () => {
    resolveAccountByEmail.mockRejectedValue(new Error('account service unavailable'))
    const authorize = createPackageAuthorizer({
      AccountsURL: 'https://accounts.test',
      PackageAuthorEmails: ['manager@example.com']
    })
    await expect(authorize(auth)).rejects.toThrow('account service unavailable')
  })
})
