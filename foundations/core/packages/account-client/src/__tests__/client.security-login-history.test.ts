//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { getClient } from '../client'

describe('AccountClient.getMySecurityLoginHistory', () => {
  const mockFetch = jest.fn()
  const originalFetch = globalThis.fetch

  beforeAll(() => {
    ;(globalThis as any).fetch = mockFetch as any
  })

  afterAll(() => {
    if (originalFetch !== undefined) {
      ;(globalThis as any).fetch = originalFetch
    } else {
      delete (globalThis as any).fetch
    }
  })

  beforeEach(() => {
    mockFetch.mockClear()
  })

  it('sends getMySecurityLoginHistory with filters', async () => {
    const payload = [{ id: 'evt-1', success: true }]
    mockFetch.mockResolvedValue({
      json: async () => ({ result: payload })
    })

    const client = getClient('https://accounts.example.com', 'token')
    const result = await client.getMySecurityLoginHistory({
      limit: 20,
      success: true,
      authMethod: 'password',
      ip: '10.0.0.1',
      redact: true
    })

    const request = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(request).toEqual({
      method: 'getMySecurityLoginHistory',
      params: {
        limit: 20,
        success: true,
        authMethod: 'password',
        ip: '10.0.0.1',
        redact: true
      }
    })
    expect(result).toEqual(payload)
  })

  it('sends empty params when no filters provided', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ result: [] })
    })

    const client = getClient('https://accounts.example.com', 'token')
    await client.getMySecurityLoginHistory()

    const request = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(request).toEqual({
      method: 'getMySecurityLoginHistory',
      params: {}
    })
  })

  it('sends exportMySecurityLoginHistory', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ result: [] })
    })

    const client = getClient('https://accounts.example.com', 'token')
    await client.exportMySecurityLoginHistory({ since: 1 })

    const request = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(request).toEqual({
      method: 'exportMySecurityLoginHistory',
      params: { since: 1 }
    })
  })

  it('sends eraseMySecurityLoginHistory', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ result: undefined })
    })

    const client = getClient('https://accounts.example.com', 'token')
    await client.eraseMySecurityLoginHistory()

    const request = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(request).toEqual({
      method: 'eraseMySecurityLoginHistory',
      params: {}
    })
  })

  it('sends reportSecurityLoginConcern with optional loginEventId', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ result: undefined })
    })

    const client = getClient('https://accounts.example.com', 'token')
    await client.reportSecurityLoginConcern({ loginEventId: 'evt-1' })

    const request = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(request).toEqual({
      method: 'reportSecurityLoginConcern',
      params: { loginEventId: 'evt-1' }
    })
  })
})
