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

import { clone } from '@hcengineering/core'
import { get } from 'svelte/store'
import { FilePreviewSession } from '../file-preview'
import { providePrintContext } from '../print'

jest.mock('svelte/store', () => jest.requireActual('../__mocks__/svelte-store'))
jest.mock('svelte', () => ({
  getContext: jest.fn(),
  setContext: jest.fn((_key: unknown, context: unknown) => context)
}))

describe('file preview lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('waits for content and isolates attachment failures from the document', () => {
    const print = providePrintContext()
    const first = new FilePreviewSession(print)
    const second = new FilePreviewSession(print)
    expect(get(print.pendingResources)).toBe(2)
    first.ready()
    second.fail(new Error('HTTP 401'))
    expect(get(first.state)).toBe('ready')
    expect(get(second.state)).toBe('error')
    expect(second.signal.aborted).toBe(true)
    expect(get(print.pendingResources)).toBe(0)
    expect(get(print.error)).toBeUndefined()
  })

  it('replaces a timed-out static preview and ignores late completion', () => {
    const print = providePrintContext()
    const session = new FilePreviewSession(print)
    jest.advanceTimersByTime(15000)
    expect(get(session.state)).toBe('error')
    expect(session.signal.aborted).toBe(true)
    session.ready()
    session.destroy()
    expect(get(session.state)).toBe('error')
    expect(get(print.pendingResources)).toBe(0)
  })

  it('does not time out interactive previews', () => {
    const session = new FilePreviewSession()
    jest.advanceTimersByTime(60000)
    expect(get(session.state)).toBe('loading')
    expect(session.signal.aborted).toBe(false)
    session.ready()
    expect(get(session.state)).toBe('ready')
    session.destroy()
  })

  it('preserves lifecycle identity across dynamic component prop cloning', () => {
    const session = new FilePreviewSession()
    expect(clone({ preview: session }).preview).toBe(session)
    session.destroy()
  })
})
