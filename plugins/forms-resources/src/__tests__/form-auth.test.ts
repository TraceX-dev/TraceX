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

import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import { requestFormEmailCode } from '../form-auth'

describe('form author email verification', () => {
  const email = 'author@example.com'
  const info = { retryOn: 123 }
  const missing = new PlatformError(new Status(Severity.ERROR, platform.status.AccountNotFound, {}))

  it('sends a login code for an existing account', async () => {
    const client = { loginOtp: jest.fn().mockResolvedValue(info), signUpOtp: jest.fn() }
    await expect(requestFormEmailCode(client, email)).resolves.toEqual(info)
    expect(client.signUpOtp).not.toHaveBeenCalled()
  })

  it('starts email verification for a new author without a password', async () => {
    const client = { loginOtp: jest.fn().mockRejectedValue(missing), signUpOtp: jest.fn().mockResolvedValue(info) }
    await expect(requestFormEmailCode(client, email)).resolves.toEqual(info)
    expect(client.signUpOtp).toHaveBeenCalledWith(email, 'author', '')
  })

  it('retries login if an account was created concurrently', async () => {
    const exists = new PlatformError(new Status(Severity.ERROR, platform.status.AccountAlreadyExists, {}))
    const client = {
      loginOtp: jest.fn().mockRejectedValueOnce(missing).mockResolvedValueOnce(info),
      signUpOtp: jest.fn().mockRejectedValue(exists)
    }
    await expect(requestFormEmailCode(client, email)).resolves.toEqual(info)
    expect(client.loginOtp).toHaveBeenCalledTimes(2)
  })

  it('does not start account creation when login fails for another reason', async () => {
    const error = new Error('Network unavailable')
    const client = { loginOtp: jest.fn().mockRejectedValue(error), signUpOtp: jest.fn() }
    await expect(requestFormEmailCode(client, email)).rejects.toBe(error)
    expect(client.signUpOtp).not.toHaveBeenCalled()
  })
})
