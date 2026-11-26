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

import { type Client, type Doc, type Hierarchy } from '@hcengineering/core'
import documents from '../plugin'
import { type AttributeModel } from '@hcengineering/view'
import { getClient } from '@hcengineering/presentation'
import tags from '@hcengineering/tags'
import { formatControlledDocumentValue } from '../docTableFormatter'

jest.mock('@hcengineering/converter-resources', () => ({
  isIntlString: (value: string) => value.includes(':string:')
}))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  translate: jest.fn(async () => 'Localized label')
}))

interface TestDocument extends Doc {
  code: string
  title: string
  major: number
  minor: number
  state: string
}

const card: Partial<TestDocument> = {
  _id: 'document-1' as TestDocument['_id'],
  _class: documents.class.Document,
  code: 'SOP-1',
  title: 'Procedure',
  major: 2,
  minor: 3,
  state: 'Effective'
}
const hierarchy: Partial<Hierarchy> = {
  isDerived: jest.fn(() => true),
  hasMixin: jest.fn(() => true)
}

async function format (attr: Partial<AttributeModel>, doc: Partial<TestDocument> = card): Promise<string | undefined> {
  return await formatControlledDocumentValue(
    attr as AttributeModel,
    doc as Doc,
    hierarchy as Hierarchy,
    documents.class.Document,
    'fr'
  )
}

describe('controlled document table values', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each([
    [documents.string.ID, 'SOP-1'],
    [documents.string.Title, 'Procedure'],
    [documents.string.Status, 'Effective'],
    [documents.string.Version, 'v2.3']
  ])('identifies the %s column independently of the translated label', async (label, expected) => {
    expect(await format({ key: '', label })).toBe(expected)
  })

  it('renders actual label titles instead of dropping the collection', async () => {
    const findAll = jest.fn().mockResolvedValue([{ title: 'Quality' }, { title: 'Approved' }])
    const client: Partial<Client> = { findAll }
    jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)

    expect(
      await format({
        key: '',
        label: documents.string.Labels,
        props: { key: 'labels', _class: documents.class.Document }
      })
    ).toBe('Quality, Approved')
    expect(findAll).toHaveBeenCalledWith(
      tags.class.TagReference,
      {
        attachedTo: card._id,
        attachedToClass: documents.class.Document,
        collection: 'labels'
      },
      { sort: { title: 1 } }
    )
  })

  it('formats a resolved template document as a version rather than its title', async () => {
    expect(await format({ key: '$lookup.template', label: documents.string.TemplateVersion })).toBe('v2.3')
  })

  it('formats a resolved template document as its code', async () => {
    expect(await format({ key: '$lookup.template', label: documents.string.Template })).toBe('SOP-1')
  })
})
