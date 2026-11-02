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

import type { Client } from '@hcengineering/core'
import platform, { getResource, PlatformError, Severity, Status } from '@hcengineering/platform'
import { getCurrentLocation, type Location } from '@hcengineering/ui'
import {
  connectEmbeddedWorkspace,
  embeddedConnectionError,
  embeddedVersionError
} from '@hcengineering/workbench-resources'
import { connect, invalidError } from './connect'
import type * as SvelteStore from 'svelte/store'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/login', () => ({
  __esModule: true,
  default: { function: { ExchangeGuestToken: 'exchange-guest-token' } }
}))
jest.mock('@hcengineering/platform', () => ({
  __esModule: true,
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn()
}))
jest.mock('svelte/store', () => jest.requireActual('../../../packages/presentation/src/__mocks__/svelte-store'))
jest.mock('@hcengineering/ui', () => ({ getCurrentLocation: jest.fn() }))
jest.mock('@hcengineering/workbench-resources', () => {
  const store = jest.requireMock<typeof SvelteStore>('svelte/store')
  return {
    connectEmbeddedWorkspace: jest.fn(),
    embeddedConnectionError: store.writable(false),
    embeddedVersionError: store.writable<string | undefined>(undefined)
  }
})

describe('public link connection failures', () => {
  const exchange = jest.fn<Promise<string>, [string]>()
  const setConnectionError = jest.spyOn(embeddedConnectionError, 'set')
  const setInvalidError = jest.spyOn(invalidError, 'set')

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    exchange.mockReset()
    jest.mocked(connectEmbeddedWorkspace).mockReset()
    embeddedVersionError.set(undefined)
    const location: Location = { path: ['guest', 'workspace'], query: { token: 'public-link-token' } }
    jest.mocked(getCurrentLocation).mockReturnValue(location)
    jest.mocked(getResource).mockResolvedValue(exchange)
    exchange.mockResolvedValue('guest-token')
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('resolves to the revoked-link state when token exchange fails', async () => {
    exchange.mockRejectedValue(new PlatformError(new Status(Severity.ERROR, platform.status.Unauthorized, {})))
    await expect(connect('Platform')).resolves.toBeUndefined()
    expect(setInvalidError).toHaveBeenCalledWith(true)
    expect(connectEmbeddedWorkspace).not.toHaveBeenCalled()
  })

  it('resolves to the revoked-link state when workspace access is denied', async () => {
    jest
      .mocked(connectEmbeddedWorkspace)
      .mockRejectedValue(new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {})))
    await expect(connect('Platform')).resolves.toBeUndefined()
    expect(setInvalidError).toHaveBeenCalledWith(true)
  })

  it('does not label a temporary workspace failure as a revoked link', async () => {
    const client: Partial<Client> = {}
    jest.mocked(connectEmbeddedWorkspace)
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockResolvedValue(client as Client)
    const result = connect('Platform')
    await jest.advanceTimersByTimeAsync(0)
    expect(setInvalidError).not.toHaveBeenCalledWith(true)
    expect(setConnectionError).toHaveBeenCalledWith(true)
    expect(connectEmbeddedWorkspace).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(999)
    expect(connectEmbeddedWorkspace).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe(client)
    expect(connectEmbeddedWorkspace).toHaveBeenCalledTimes(2)
  })

  it('does not label a token exchange network failure as a revoked link', async () => {
    const client: Partial<Client> = {}
    exchange.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue('guest-token')
    jest.mocked(connectEmbeddedWorkspace).mockResolvedValue(client as Client)
    const result = connect('Platform')
    await jest.advanceTimersByTimeAsync(0)
    expect(setInvalidError).not.toHaveBeenCalledWith(true)
    expect(setConnectionError).toHaveBeenCalledWith(true)
    await jest.advanceTimersByTimeAsync(1000)
    await expect(result).resolves.toBe(client)
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('stops retrying when the guest location changes', async () => {
    jest.mocked(connectEmbeddedWorkspace).mockRejectedValue(new Error('Service unavailable'))
    const result = connect('Platform')
    await jest.advanceTimersByTimeAsync(0)
    const location: Location = { path: ['workbench', 'workspace'] }
    jest.mocked(getCurrentLocation).mockReturnValue(location)
    await jest.advanceTimersByTimeAsync(1000)
    await expect(result).resolves.toBeUndefined()
    expect(connectEmbeddedWorkspace).toHaveBeenCalledTimes(1)
  })

  it('backs off repeated failures and caps the delay at ten seconds', async () => {
    const client: Partial<Client> = {}
    jest.mocked(connectEmbeddedWorkspace).mockRejectedValue(new Error('Service unavailable'))
    const result = connect('Platform')
    await jest.advanceTimersByTimeAsync(0)
    let attempts = 1
    for (const delay of [1000, 2000, 4000, 8000, 10000, 10000]) {
      await jest.advanceTimersByTimeAsync(delay - 1)
      expect(connectEmbeddedWorkspace).toHaveBeenCalledTimes(attempts)
      await jest.advanceTimersByTimeAsync(1)
      expect(connectEmbeddedWorkspace).toHaveBeenCalledTimes(++attempts)
    }
    jest.mocked(connectEmbeddedWorkspace).mockResolvedValue(client as Client)
    await jest.advanceTimersByTimeAsync(10000)
    await expect(result).resolves.toBe(client)
  })

  it('preserves a version mismatch without marking the public link invalid', async () => {
    const setVersionError = jest.spyOn(embeddedVersionError, 'set')
    jest.mocked(connectEmbeddedWorkspace).mockImplementation(async () => {
      embeddedVersionError.set('Client and server versions do not match')
      throw new Error('Version mismatch')
    })
    await expect(connect('Platform')).resolves.toBeUndefined()
    expect(setInvalidError).not.toHaveBeenCalledWith(true)
    expect(setVersionError).toHaveBeenCalledWith('Client and server versions do not match')
    expect(jest.getTimerCount()).toBe(0)
  })

  it('does not attempt a connection without a public-link token', async () => {
    const location: Location = { path: ['guest', 'workspace'] }
    jest.mocked(getCurrentLocation).mockReturnValue(location)
    await expect(connect('Platform')).resolves.toBeUndefined()
    expect(setInvalidError).toHaveBeenCalledWith(true)
    expect(getResource).not.toHaveBeenCalled()
    expect(connectEmbeddedWorkspace).not.toHaveBeenCalled()
  })

  it('opens a valid public link with the exchanged token', async () => {
    const client: Partial<Client> = {}
    jest.mocked(connectEmbeddedWorkspace).mockResolvedValue(client as Client)
    await expect(connect('Platform')).resolves.toBe(client)
    expect(exchange).toHaveBeenCalledWith('public-link-token')
    expect(connectEmbeddedWorkspace).toHaveBeenCalledWith('Platform', 'workspace', 'guest-token')
    expect(setConnectionError).not.toHaveBeenCalledWith(true)
    expect(setInvalidError).not.toHaveBeenCalledWith(true)
  })
})
