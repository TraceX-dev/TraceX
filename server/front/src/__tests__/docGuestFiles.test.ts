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

import { docGuestAccountUuid, type WorkspaceIds } from '@hcengineering/core'

const tokens: Record<string, any> = {
  link: { account: docGuestAccountUuid, extra: { guest: 'true', linkId: 'link-a' } },
  nolink: { account: docGuestAccountUuid, extra: { guest: 'true' } },
  user: { account: 'user-uuid', extra: {} },
  readonly: { account: 'ro-uuid', extra: { readonly: 'true' } },
  guestExtra: { account: 'g-uuid', extra: { guest: 'true' } }
}

jest.mock('@hcengineering/server-token', () => ({
  decodeToken: (token: string) => {
    if (tokens[token] === undefined) throw new Error('bad token')
    return tokens[token]
  }
}))

import { canTokenWriteFiles, createDocGuestFileChecker, getDocGuestLinkId } from '../docGuestFiles'

const ws = { uuid: 'ws-1', url: 'ws', dataId: 'ws-1' } as unknown as WorkspaceIds

describe('docGuestFiles', () => {
  it('detects shared-link tokens', () => {
    expect(getDocGuestLinkId('link')).toBe('link-a')
    expect(getDocGuestLinkId('nolink')).toBe('')
    expect(getDocGuestLinkId('user')).toBeUndefined()
    expect(getDocGuestLinkId('broken')).toBeUndefined()
  })

  it('does not let guest, read-only or invalid tokens write files', () => {
    expect(canTokenWriteFiles('user')).toBe(true)
    expect(canTokenWriteFiles('link')).toBe(false)
    expect(canTokenWriteFiles('readonly')).toBe(false)
    expect(canTokenWriteFiles('guestExtra')).toBe(false)
    expect(canTokenWriteFiles('broken')).toBe(false)
  })

  function make (visible: string[]): {
    checker: ReturnType<typeof createDocGuestFileChecker>
    connect: jest.Mock
    close: jest.Mock
  } {
    const close = jest.fn(async () => {})
    const connect = jest.fn(async () => ({
      findOne: async (_class: unknown, query: { _id: string }) =>
        visible.includes(query._id) ? { _id: query._id } : undefined,
      close
    }))
    const checker = createDocGuestFileChecker({
      resolveEndpoint: async () => 'ws://transactor',
      connect: connect as any
    })
    return { checker, connect, close }
  }

  it('allows a file only when the guest session can read its blob', async () => {
    const { checker, connect, close } = make(['blob-1'])
    expect(await checker.canRead(ws, 'link', 'blob-1')).toBe(true)
    expect(await checker.canRead(ws, 'link', 'blob-2')).toBe(false)
    expect(connect).toHaveBeenCalledWith('ws://transactor', 'link')
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('denies tokens that are not bound to a link without asking the transactor', async () => {
    const { checker, connect } = make(['blob-1'])
    expect(await checker.canRead(ws, 'nolink', 'blob-1')).toBe(false)
    expect(await checker.canRead(ws, 'user', 'blob-1')).toBe(false)
    expect(connect).not.toHaveBeenCalled()
  })

  it('caches decisions and does not cache failures', async () => {
    const { checker, connect } = make(['blob-1'])
    await checker.canRead(ws, 'link', 'blob-1')
    await checker.canRead(ws, 'link', 'blob-1')
    expect(connect).toHaveBeenCalledTimes(1)

    const failing = createDocGuestFileChecker({
      resolveEndpoint: async () => 'ws://transactor',
      connect: async () => {
        throw new Error('down')
      }
    })
    expect(await failing.canRead(ws, 'link', 'blob-1')).toBe(false)
  })
})
