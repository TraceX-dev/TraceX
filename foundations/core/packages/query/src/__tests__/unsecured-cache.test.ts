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

import core, {
  type Class,
  type Client,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  Hierarchy,
  ModelDb,
  type Ref,
  toFindResult,
  TxFactory
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { Refs } from '../refs'
import { ResultArray } from '../results'
import type { Query } from '../types'
import { genMinModel, test } from './minmodel'

interface CachedDoc extends Doc {
  label: string
  secret?: string
}

const CLASS = test.class.TestComment as Ref<Class<CachedDoc>>
const FULL: CachedDoc = {
  _id: 'test:doc:target' as Ref<CachedDoc>,
  _class: CLASS,
  space: core.space.Workspace,
  modifiedOn: 1,
  modifiedBy: core.account.System,
  label: 'Target',
  secret: 'Private content'
}
const { secret, ...PROJECTED } = FULL

function makeHierarchy (): Hierarchy {
  const hierarchy = new Hierarchy()
  for (const tx of genMinModel()) hierarchy.tx(tx)
  return hierarchy
}

function makeQuery (hierarchy: Hierarchy, id: number, options?: FindOptions<Doc>): Query {
  return {
    id,
    _class: CLASS,
    query: {},
    result: new ResultArray([], hierarchy),
    options,
    total: -1,
    callbacks: new Map(),
    refresh: async () => {},
    refreshId: 0
  }
}

describe('unsecured document cache isolation', () => {
  it.each([true, false])('does not reuse a document cached with unsecured=%s in the other mode', (unsecured) => {
    const hierarchy = makeHierarchy()
    const refs = new Refs(() => hierarchy)
    refs.updateDocuments(makeQuery(hierarchy, 1, { unsecured }), [unsecured ? PROJECTED : FULL])

    expect(refs.findFromDocs(CLASS, { _id: FULL._id }, { unsecured: !unsecured })).toBeNull()
    expect(refs.findFromDocs(CLASS, { _id: FULL._id }, { unsecured })?.[0]).toEqual(unsecured ? PROJECTED : FULL)
  })

  it('keeps full and projected versions of the same ID independently', () => {
    const hierarchy = makeHierarchy()
    const refs = new Refs(() => hierarchy)
    refs.updateDocuments(makeQuery(hierarchy, 1), [FULL])
    refs.updateDocuments(makeQuery(hierarchy, 2, { unsecured: true }), [PROJECTED])

    expect(refs.findFromDocs(CLASS, { _id: FULL._id })?.[0]).toEqual(FULL)
    expect(refs.findFromDocs(CLASS, { _id: FULL._id }, { unsecured: false })?.[0]).toEqual(FULL)
    expect(refs.findFromDocs(CLASS, { _id: FULL._id }, { unsecured: true })?.[0]).toEqual(PROJECTED)
  })

  it.each([true, false])('keeps the lookup fallback in the same mode when unsecured=%s', (unsecured) => {
    const hierarchy = makeHierarchy()
    const refs = new Refs(() => hierarchy)
    const options = { unsecured, lookup: { space: core.class.Space } }
    refs.updateDocuments(makeQuery(hierarchy, 1, options), [unsecured ? PROJECTED : FULL])

    expect(refs.findFromDocs(CLASS, {}, { unsecured: !unsecured, limit: 1 })).toBeNull()
    expect(refs.findFromDocs(CLASS, {}, { unsecured, limit: 1 })?.[0]).toEqual(unsecured ? PROJECTED : FULL)
  })

  it('cleans up one mode without removing the other mode', () => {
    const hierarchy = makeHierarchy()
    const refs = new Refs(() => hierarchy)
    const unsecuredQuery = makeQuery(hierarchy, 2, { unsecured: true })
    refs.updateDocuments(makeQuery(hierarchy, 1), [FULL])
    refs.updateDocuments(unsecuredQuery, [PROJECTED])

    refs.updateDocuments(unsecuredQuery, [PROJECTED], true)

    expect(refs.findFromDocs(CLASS, { _id: FULL._id }, { unsecured: true })).toBeNull()
    expect(refs.findFromDocs(CLASS, { _id: FULL._id })?.[0]).toEqual(FULL)
  })

  it('preserves unsecured during transaction refresh and separates its temporary cache', async () => {
    const hierarchy = makeHierarchy()
    const findAll = jest.fn(async (_class: Ref<Class<Doc>>, _query: DocumentQuery<Doc>, options?: FindOptions<Doc>) =>
      toFindResult([{ ...(options?.unsecured === true ? PROJECTED : FULL) }], 1)
    )
    const findOne = jest.fn(
      async (_class: Ref<Class<Doc>>, _query: DocumentQuery<Doc>, options?: FindOptions<Doc>) => ({
        ...(options?.unsecured === true ? PROJECTED : FULL)
      })
    )
    const client = {
      getHierarchy: () => hierarchy,
      getModel: () => new ModelDb(hierarchy),
      findAll,
      findOne
    } as unknown as Client
    const query = new LiveQuery(client)
    await query.findAll(CLASS, { _id: FULL._id })
    await query.findAll(CLASS, { _id: FULL._id }, { unsecured: true })
    const tx = new TxFactory(core.account.System).createTxUpdateDoc(CLASS, FULL.space, FULL._id, { label: 'Updated' })
    tx.modifiedOn = FULL.modifiedOn

    await query.txUpdateDoc(tx, new Map())

    expect(findOne).toHaveBeenCalledTimes(2)
    expect(findOne.mock.calls.some((call) => call[2]?.unsecured === true)).toBe(true)
    expect(findOne.mock.calls.some((call) => call[2]?.unsecured !== true)).toBe(true)
    expect((await query.findAll(CLASS, { _id: FULL._id }))[0]).toEqual(FULL)
    expect((await query.findAll(CLASS, { _id: FULL._id }, { unsecured: true }))[0]).toEqual(PROJECTED)
  })
})
