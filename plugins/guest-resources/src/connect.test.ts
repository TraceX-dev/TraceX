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
import { getResource } from '@hcengineering/platform'
import { getCurrentLocation, type Location } from '@hcengineering/ui'
import { connectEmbeddedWorkspace, embeddedConnectionError } from '@hcengineering/workbench-resources'
import { connect } from './connect'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/login', () => ({
  __esModule: true,
  default: { function: { ExchangeGuestToken: 'exchange-guest-token' } }
}))
jest.mock('@hcengineering/platform', () => ({ getResource: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({ getCurrentLocation: jest.fn() }))
jest.mock('@hcengineering/workbench-resources', () => ({
  connectEmbeddedWorkspace: jest.fn(),
  embeddedConnectionError: { set: jest.fn() },
  embeddedVersionError: { set: jest.fn() }
}))

describe('public link connection failures', () => {
  const exchange = jest.fn<Promise<string>, [string]>()
  const setConnectionError = jest.spyOn(embeddedConnectionError, 'set')

  beforeEach(() => {
    jest.resetAllMocks()
    const location: Location = { path: ['guest', 'workspace'], query: { token: 'public-link-token' } }
    jest.mocked(getCurrentLocation).mockReturnValue(location)
    jest.mocked(getResource).mockResolvedValue(exchange)
    exchange.mockResolvedValue('guest-token')
  })

  it('resolves to the revoked-link state when token exchange fails', async () => {
    exchange.mockRejectedValue(new Error('Public link revoked'))
    await expect(connect('Platform')).resolves.toBeUndefined()
    expect(setConnectionError).toHaveBeenCalledWith(true)
    expect(connectEmbeddedWorkspace).not.toHaveBeenCalled()
  })

  it('resolves to the revoked-link state when workspace access is denied', async () => {
    jest.mocked(connectEmbeddedWorkspace).mockRejectedValue(new Error('Unauthorized'))
    await expect(connect('Platform')).resolves.toBeUndefined()
    expect(setConnectionError).toHaveBeenCalledWith(true)
  })

  it('does not attempt a connection without a public-link token', async () => {
    const location: Location = { path: ['guest', 'workspace'] }
    jest.mocked(getCurrentLocation).mockReturnValue(location)
    await expect(connect('Platform')).resolves.toBeUndefined()
    expect(setConnectionError).toHaveBeenCalledWith(true)
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
  })
})
