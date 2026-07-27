//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

// `@hcengineering/view-resources` pulls in svelte; the unit under test only uses `filtersToQuery`.
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/view-resources', () => ({ filtersToQuery: jest.fn() }))

import { getClient } from '@hcengineering/presentation'
import { filtersToQuery } from '@hcengineering/view-resources'

import { ChangeControlPurpose, buildCardRelationQuery, getChangeControlAssociations } from '../changeControl'

function mockClient (hierarchy: any, associations: any[] = []): void {
  ;(getClient as jest.Mock).mockReturnValue({
    getHierarchy: () => hierarchy,
    getModel: () => ({ findAllSync: () => associations })
  })
}

const association = { _id: 'assoc1', classB: 'card:type:ChangeRequest' } as any

describe('buildCardRelationQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns an empty query for a non-versionable card without a mixin', async () => {
    mockClient({ hasMixin: () => false, classHierarchyMixin: () => undefined })
    const q = await buildCardRelationQuery(association)
    expect(q).toEqual({})
  })

  it('restricts to the latest version for versionable cards by default', async () => {
    mockClient({ hasMixin: () => false, classHierarchyMixin: () => ({}) })
    const q = await buildCardRelationQuery(association)
    expect(q).toEqual({ isLatest: true })
  })

  it('excludes already-linked cards via $nin', async () => {
    mockClient({ hasMixin: () => false, classHierarchyMixin: () => ({}) })
    const q = await buildCardRelationQuery(association, ['c1', 'c2'] as any)
    expect(q).toEqual({ isLatest: true, _id: { $nin: ['c1', 'c2'] } })
  })

  it('drops the latest-version restriction when requireLatest is false', async () => {
    mockClient({
      hasMixin: () => true,
      as: () => ({ requireLatest: false }),
      classHierarchyMixin: () => ({})
    })
    const q = await buildCardRelationQuery(association)
    expect(q).toEqual({})
  })

  it('applies the stored filter through filtersToQuery', async () => {
    const stored = [{ key: { key: 'status' } }]
    mockClient({
      hasMixin: () => true,
      as: () => ({ filter: JSON.stringify(stored) }),
      classHierarchyMixin: () => ({})
    })
    ;(filtersToQuery as jest.Mock).mockResolvedValue({ isLatest: true, status: { $in: ['final'] } })

    const q = await buildCardRelationQuery(association)

    expect(filtersToQuery as jest.Mock).toHaveBeenCalledWith(stored, { isLatest: true })
    expect(q).toEqual({ isLatest: true, status: { $in: ['final'] } })
  })

  it('ignores a malformed filter without throwing', async () => {
    mockClient({
      hasMixin: () => true,
      as: () => ({ filter: '{not json' }),
      classHierarchyMixin: () => ({})
    })
    const q = await buildCardRelationQuery(association)
    expect(q).toEqual({ isLatest: true })
    expect(filtersToQuery as jest.Mock).not.toHaveBeenCalled()
  })
})

describe('getChangeControlAssociations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps only associations marked with the change-control purpose', () => {
    const a1 = { _id: 'a1', _cc: true, _purpose: ChangeControlPurpose }
    const a2 = { _id: 'a2', _cc: false, _purpose: undefined }
    const a3 = { _id: 'a3', _cc: true, _purpose: 'other' }
    mockClient(
      {
        hasMixin: (a: any) => a._cc === true,
        as: (a: any) => ({ purpose: a._purpose })
      },
      [a1, a2, a3]
    )

    const result = getChangeControlAssociations()
    expect(result.map((a) => a._id)).toEqual(['a1'])
  })

  it('returns an empty list when nothing is configured', () => {
    mockClient({ hasMixin: () => false, as: () => ({}) }, [])
    expect(getChangeControlAssociations()).toEqual([])
  })
})
