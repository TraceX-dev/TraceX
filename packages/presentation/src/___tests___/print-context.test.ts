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

import { getContext } from 'svelte'
import { get } from 'svelte/store'
import { getPrintContext, providePrintContext } from '../print'

jest.mock('svelte/store', () => jest.requireActual('../__mocks__/svelte-store'))
jest.mock('svelte', () => ({
  getContext: jest.fn(),
  setContext: jest.fn((_key: unknown, context: unknown) => context)
}))

describe('print rendering context', () => {
  it('requires the document to mount and preserves fatal rendering errors', () => {
    const context = providePrintContext()
    const finish = context.registerResource()
    expect(get(context.documentReady)).toBe(false)
    context.markDocumentReady()
    expect(get(context.documentReady)).toBe(true)
    expect(get(context.pendingResources)).toBe(1)
    const error = new Error('Editor initialization failed')
    context.fail(error)
    finish()
    expect(get(context.error)).toBe(error)
    expect(get(context.pendingResources)).toBe(0)
  })

  it('isolates pending resources between print applications', () => {
    const first = providePrintContext()
    const finishFirst = first.registerResource()
    const second = providePrintContext()
    const finishSecond = second.registerResource()
    const finishAnother = first.registerResource()

    expect(get(first.pendingResources)).toBe(2)
    expect(get(second.pendingResources)).toBe(1)
    finishFirst()
    finishSecond()
    expect(get(first.pendingResources)).toBe(1)
    expect(get(second.pendingResources)).toBe(0)
    finishAnother()
    expect(get(first.pendingResources)).toBe(0)
  })

  it('allows completion and destruction to release the same resource', () => {
    const context = providePrintContext()
    const finish = context.registerResource()
    const finishAnother = context.registerResource()

    finish()
    finish()
    expect(get(context.pendingResources)).toBe(1)
    finishAnother()
    expect(get(context.pendingResources)).toBe(0)
  })

  it('leaves regular views outside the print context', () => {
    jest.mocked(getContext).mockReturnValue(undefined)
    expect(getPrintContext()).toBeUndefined()
    const context = providePrintContext()
    jest.mocked(getContext).mockReturnValue(context)
    expect(getPrintContext()).toBe(context)
  })
})
