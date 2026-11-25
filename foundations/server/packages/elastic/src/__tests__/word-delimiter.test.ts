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

import { Client } from '@elastic/elasticsearch'
import {
  type Class,
  type Doc,
  generateId,
  MeasureMetricsContext,
  type PersonId,
  type Ref,
  type Space,
  type WorkspaceUuid
} from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverCore, { type FullTextAdapter, type IndexedDoc } from '@hcengineering/server-core'

import { createElasticAdapter } from '../adapter'

const elasticUrl = process.env.ELASTIC_URL ?? 'http://localhost:9201/'

const testClass = 'test:class:WordDelimiterDoc' as Ref<Class<Doc>>
const codeDoc = 'code-doc' as Ref<Doc>
const possessiveDoc = 'possessive-doc' as Ref<Doc>
const plainDoc = 'plain-doc' as Ref<Doc>

function makeDoc (id: Ref<Doc>, fulltextSummary: string): IndexedDoc {
  return {
    id,
    _class: [testClass],
    space: 'space1' as Ref<Space>,
    modifiedBy: 'tester' as PersonId,
    modifiedOn: Date.now(),
    fulltextSummary
  }
}

describe('Elastic word delimiter analyzer', () => {
  const ctx = new MeasureMetricsContext('-', {})
  // A dedicated index base name: initMapping drops other versions of the same
  // base name only, so this test never touches indexes used by other tests.
  const indexBaseName = `test_word_delimiter_${generateId()}`.toLowerCase()
  const workspace = `ws-${generateId()}` as WorkspaceUuid
  let adapter: FullTextAdapter

  async function find (query: string): Promise<Array<Ref<Doc>>> {
    const hits = await adapter.search(ctx, workspace, [testClass], { $search: query }, 50)
    return hits.map((it) => it.id).sort()
  }

  beforeAll(async () => {
    setMetadata(serverCore.metadata.ElasticIndexName, indexBaseName)
    adapter = await createElasticAdapter(elasticUrl)
    expect(await adapter.initMapping(ctx)).toBe(true)

    await adapter.updateMany(ctx, workspace, [
      makeDoc(codeDoc, 'Requirement ABC_DEFGH-12 for the XYZ123 module'),
      makeDoc(possessiveDoc, "FooBar John's notes"),
      makeDoc(plainDoc, 'Plain text without any codes')
    ])
  }, 60000)

  afterAll(async () => {
    await adapter?.close()
    const client = new Client({ node: elasticUrl })
    try {
      await client.indices.delete({ index: `${indexBaseName}_*` })
    } finally {
      await client.close()
      setMetadata(serverCore.metadata.ElasticIndexName, undefined as unknown as string)
    }
  }, 60000)

  it.each([
    ['abc_defgh'],
    ['ABC_DEFGH-12'],
    ['"ABC_DEFGH-12"'],
    ['abc'],
    ['defgh'],
    ['12'],
    ['def*'],
    ['abc* def*'],
    ['abc_def*']
  ])('finds an underscore/hyphen code by %s', async (query) => {
    expect(await find(query)).toEqual([codeDoc])
  })

  it.each([['xyz123'], ['xyz'], ['123']])('finds a letter/digit code by %s', async (query) => {
    expect(await find(query)).toEqual([codeDoc])
  })

  it.each([['foobar'], ['foo'], ['bar']])('finds a camel-case word by %s', async (query) => {
    expect(await find(query)).toEqual([possessiveDoc])
  })

  it('keeps English stemming', async () => {
    expect(await find('note')).toEqual([possessiveDoc])
    expect(await find('requirements')).toEqual([codeDoc])
  })

  it("strips the possessive 's instead of emitting a stray part", async () => {
    expect(await find('john')).toEqual([possessiveDoc])
    expect(await find('s')).toEqual([])
  })

  it('does not match the middle of a part', async () => {
    expect(await find('fgh')).toEqual([])
    expect(await find('def')).toEqual([])
  })

  it('still finds ordinary words', async () => {
    expect(await find('plain')).toEqual([plainDoc])
  })
})
