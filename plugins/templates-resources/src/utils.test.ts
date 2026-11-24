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

import core, { type Client, type Doc } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import type { TemplateDataProvider, TemplateField } from '@hcengineering/templates'
import { getTemplateDataProvider } from './utils'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn()
}))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))

beforeEach(() => {
  jest.clearAllMocks()
  const field: Partial<TemplateField> = {}
  const client: Partial<Client> = { findOne: jest.fn().mockResolvedValue(field) }
  jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)
})

it('replaces repeated registered fields once and missing values with empty text', async () => {
  const resolve = jest.fn().mockResolvedValue(undefined)
  jest.mocked(getResource).mockResolvedValue(resolve)
  const provider = getTemplateDataProvider()
  try {
    await expect(provider.fillTemplate(`A \${field} / \${field} B`)).resolves.toBe('A  /  B')
    expect(resolve).toHaveBeenCalledTimes(1)
  } finally {
    provider.destroy()
  }
})

it('treats a field result as literal text instead of evaluating nested-looking values', async () => {
  jest.mocked(getResource).mockResolvedValue(jest.fn().mockResolvedValue(`Document "A" <B> \${another-field}`))
  const provider = getTemplateDataProvider()
  try {
    await expect(provider.fillTemplate(`\${title}`)).resolves.toBe(`Document "A" <B> \${another-field}`)
  } finally {
    provider.destroy()
  }
})

it('keeps independently resolving providers isolated even when calls overlap', async () => {
  jest.mocked(getResource).mockResolvedValue(async (provider: TemplateDataProvider) => {
    await Promise.resolve()
    const document: Partial<Doc> & { title: string } = provider.get(core.class.Doc)
    return document.title
  })
  const first = getTemplateDataProvider({ inheritContext: false })
  const second = getTemplateDataProvider({ inheritContext: false })
  const a: Partial<Doc> & { title: string } = { title: 'First' }
  const b: Partial<Doc> & { title: string } = { title: 'Second' }
  first.set(core.class.Doc, a)
  second.set(core.class.Doc, b)
  try {
    await expect(
      Promise.all([first.fillTemplate(`\${title} \${title}`), second.fillTemplate(`\${title}`)])
    ).resolves.toEqual(['First First', 'Second'])
  } finally {
    first.destroy()
    second.destroy()
  }
})

it('does not read another editor context when context inheritance is disabled', () => {
  const editor = getTemplateDataProvider()
  const isolated = getTemplateDataProvider({ inheritContext: false })
  const document: Partial<Doc> = {}
  editor.set(core.class.Doc, document)
  try {
    expect(isolated.get(core.class.Doc)).toBeUndefined()
  } finally {
    editor.destroy()
    isolated.destroy()
  }
})
