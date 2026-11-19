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

import type { Client, Doc, Ref, Class, Space, PersonId, TxOperations } from '@hcengineering/core'
import { getMetadata } from '@hcengineering/platform'
import { getDocTitle } from '@hcengineering/view-resources'
import { printToPDF } from '@hcengineering/print'
import { signPDF } from '@hcengineering/sign'
import { printAll } from './printUtils'
import type { PrintAllOptions } from './printUtils'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/platform', () => ({ getMetadata: jest.fn(() => 'token') }))
jest.mock('@hcengineering/print', () => ({ printToPDF: jest.fn() }))
jest.mock('@hcengineering/sign', () => ({
  __esModule: true,
  default: { metadata: { SignURL: 'sign-url' } },
  signPDF: jest.fn()
}))
jest.mock('@hcengineering/view-resources', () => ({ getDocTitle: jest.fn(async () => 'Document') }))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: { metadata: { Token: 'token' } },
  getFileUrl: jest.fn()
}))

const doc: Doc = {
  _id: 'document' as Ref<Doc>,
  _class: 'test:class:Document' as Ref<Class<Doc>>,
  space: 'space' as Ref<Space>,
  modifiedBy: 'person' as PersonId,
  modifiedOn: 1
}
const client: Partial<Client> & Pick<TxOperations, 'createDoc' | 'createMixin' | 'updateMixin'> = {
  findOne: jest.fn(),
  createDoc: jest.fn(),
  createMixin: jest.fn(),
  updateMixin: jest.fn()
}
const options: PrintAllOptions = { onProgress: jest.fn(), getCancelled: () => false }

describe('bulk PDF export', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getMetadata).mockImplementation((key) => (key === 'sign-url' ? 'https://sign.local' : 'token'))
    jest.mocked(getDocTitle).mockResolvedValue('Document')
    jest.mocked(printToPDF).mockResolvedValue('pdf')
    jest.mocked(signPDF).mockResolvedValue('signed-pdf')
  })

  it('prints the target without creating or looking up public links', async () => {
    const result = await printAll(client as Client, [doc], false, options)
    expect(printToPDF).toHaveBeenCalledWith(doc, 'token', undefined)
    expect(client.findOne).not.toHaveBeenCalled()
    expect(client.createDoc).not.toHaveBeenCalled()
    expect(result).toEqual([{ blobId: 'pdf', title: 'Document.pdf', error: undefined }])
  })

  it('uses the same selected orientation for every document and ignores legacy preferences', async () => {
    const legacy: Record<string, unknown> = { 'print:mixin:PrintOptions': { orientation: 'landscape' } }
    const secondDoc: Doc = { ...doc, ...legacy, _id: 'second-document' as Ref<Doc> }
    const selection: PrintAllOptions = { ...options, printOptions: { orientation: 'portrait' } }
    await printAll(client as Client, [doc, secondDoc], true, selection)
    expect(printToPDF).toHaveBeenNthCalledWith(1, doc, 'token', selection.printOptions)
    expect(printToPDF).toHaveBeenNthCalledWith(2, secondDoc, 'token', selection.printOptions)
    expect(signPDF).toHaveBeenCalledTimes(2)
    expect(client.createMixin).not.toHaveBeenCalled()
    expect(client.updateMixin).not.toHaveBeenCalled()
  })

  it('signs the successfully rendered PDF', async () => {
    const result = await printAll(client as Client, [doc], true, options)
    expect(signPDF).toHaveBeenCalledWith('pdf', 'token')
    expect(result[0].blobId).toBe('signed-pdf')
  })

  it('prints without a signature when the signing service is not configured', async () => {
    jest.mocked(getMetadata).mockImplementation((key) => (key === 'sign-url' ? '' : 'token'))
    const result = await printAll(client as Client, [doc], true, options)
    expect(result[0].blobId).toBe('pdf')
    expect(signPDF).not.toHaveBeenCalled()
  })

  it('reports a signing failure without returning the unsigned PDF', async () => {
    jest.mocked(signPDF).mockRejectedValue(new Error('Signature failed'))
    const result = await printAll(client as Client, [doc], true, options)
    expect(result[0].error).toContain('Signature failed')
    expect(result[0].blobId).toBe('')
  })

  it('requires a title and uses the title field when the provider has no value', async () => {
    jest.mocked(getDocTitle).mockResolvedValue(undefined)
    const attributes = { title: 'Stored title' }
    const titledDoc: Doc = { ...doc, ...attributes }
    const result = await printAll(client as Client, [titledDoc, doc], false, options)
    expect(result[0].title).toBe('Stored title.pdf')
    expect(result[1].error).toContain('Document title is required')
    expect(printToPDF).toHaveBeenCalledTimes(1)
  })

  it('reports per-document failures without attempting a signature', async () => {
    jest.mocked(printToPDF).mockRejectedValue(new Error('Document unavailable'))
    const result = await printAll(client as Client, [doc], true, options)
    expect(result[0].error).toContain('Document unavailable')
    expect(result[0].blobId).toBe('')
    expect(signPDF).not.toHaveBeenCalled()
  })

  it('does not begin a cancelled export', async () => {
    const selection: PrintAllOptions = { ...options, getCancelled: () => true }
    expect(await printAll(client as Client, [doc], false, selection)).toEqual([])
    expect(printToPDF).not.toHaveBeenCalled()
  })
})
