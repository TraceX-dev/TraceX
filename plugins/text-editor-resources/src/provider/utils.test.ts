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

import type { Blob, Class, CollaborativeDoc, Doc, Ref } from '@hcengineering/core'
import { Doc as YDoc } from 'yjs'
import { createRemoteProvider } from './utils'

const baseDestroy = jest.fn()
let lastConfig: any

jest.mock('@hcengineering/core', () => ({
  generateId: () => 'guid-1'
}))

jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: {
    metadata: {
      Token: 'token',
      CollaboratorUrl: 'collaboratorUrl',
      WorkspaceUuid: 'workspaceUuid'
    }
  }
}))

jest.mock('@hcengineering/platform', () => {
  const getMetadata = jest.fn()
  const setPlatformStatus = jest.fn()

  class Status {
    severity: any
    code: any
    params: any

    constructor (severity: any, code: any, params: any) {
      this.severity = severity
      this.code = code
      this.params = params
    }
  }

  return {
    OK: { code: 'OK' },
    Severity: { ERROR: 'ERROR' },
    Status,
    getMetadata,
    setPlatformStatus
  }
})

jest.mock('@hcengineering/collaborator-client', () => {
  const encodeDocumentId = jest.fn()
  return { encodeDocumentId }
})

jest.mock('../plugin', () => ({
  __esModule: true,
  default: {
    string: {
      CannotConnectToCollaborationService: 'CannotConnectToCollaborationService'
    }
  }
}))

jest.mock('./hocuspocus', () => ({
  HocuspocusCollabProvider: class {
    destroy: () => void

    constructor (config: any) {
      lastConfig = config
      this.destroy = baseDestroy
    }
  }
}))

describe('createRemoteProvider', () => {
  const RECONNECT_GRACE_MS = 5000
  const platformMock = jest.requireMock('@hcengineering/platform')
  const collaboratorClientMock = jest.requireMock('@hcengineering/collaborator-client')

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    baseDestroy.mockReset()
    lastConfig = undefined

    platformMock.getMetadata.mockImplementation((key: string) => {
      if (key === 'token') return 'token-1'
      if (key === 'collaboratorUrl') return 'wss://collab.example/ws'
      if (key === 'workspaceUuid') return 'ws-1'
      return undefined
    })
    collaboratorClientMock.encodeDocumentId.mockReturnValue('encoded-doc-id')
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const document: CollaborativeDoc = {
    objectClass: 'card:types:Document' as Ref<Class<Doc>>,
    objectId: 'card-1' as Ref<Doc>,
    objectAttr: 'content'
  }

  it.each([null, '' as Ref<Blob>])('omits an absent initial content reference (%s)', (content) => {
    const ydoc = new YDoc()
    const provider = createRemoteProvider(ydoc, document, content)
    try {
      expect(new URL(lastConfig.url).searchParams.has('content')).toBe(false)
    } finally {
      void provider.destroy()
      ydoc.destroy()
    }
  })

  it('passes a persisted initial content reference to the collaborator', () => {
    const ydoc = new YDoc()
    const content = 'snapshot-1' as Ref<Blob>
    const provider = createRemoteProvider(ydoc, document, content)
    try {
      expect(new URL(lastConfig.url).searchParams.get('content')).toBe(content)
    } finally {
      void provider.destroy()
      ydoc.destroy()
    }
  })

  it('does not report error before grace timeout', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    createRemoteProvider({} as any, 'doc-1' as any, null)

    lastConfig.onClose({ event: { code: 1006 } })
    jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1)

    expect(errorSpy).not.toHaveBeenCalled()
    expect(platformMock.setPlatformStatus).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('starts grace timer once and does not postpone on repeated 1006 closes', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    createRemoteProvider({} as any, 'doc-1' as any, null)

    lastConfig.onClose({ event: { code: 1006 } })
    jest.advanceTimersByTime(2000)
    lastConfig.onClose({ event: { code: 1006 } })
    jest.advanceTimersByTime(2000)
    lastConfig.onClose({ event: { code: 1006 } })
    jest.advanceTimersByTime(1000)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(platformMock.setPlatformStatus).toHaveBeenCalledTimes(1)

    errorSpy.mockRestore()
  })

  it('clears pending error when reconnect succeeds in grace window', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    createRemoteProvider({} as any, 'doc-1' as any, null)

    lastConfig.onClose({ event: { code: 1006 } })
    jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1000)
    lastConfig.onConnect()
    jest.advanceTimersByTime(RECONNECT_GRACE_MS + 1000)

    expect(errorSpy).not.toHaveBeenCalled()
    expect(platformMock.setPlatformStatus).toHaveBeenCalledTimes(1)
    expect(platformMock.setPlatformStatus).toHaveBeenCalledWith({ code: 'OK' })

    errorSpy.mockRestore()
  })

  it('clears pending error timer on provider destroy', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const provider = createRemoteProvider({} as any, 'doc-1' as any, null)

    lastConfig.onClose({ event: { code: 1006 } })
    void provider.destroy()
    jest.advanceTimersByTime(RECONNECT_GRACE_MS + 1000)

    expect(baseDestroy).toHaveBeenCalledTimes(1)
    expect(errorSpy).not.toHaveBeenCalled()
    expect(platformMock.setPlatformStatus).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })
})
