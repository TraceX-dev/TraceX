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

import core, { type Association } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'

import { filtersToQuery } from '../filter'
import {
  buildRelationCandidatesQuery,
  commitPendingRelations,
  getRelationCandidatesClass,
  type PendingRelation
} from '../relations'

jest.mock('@hcengineering/presentation', () => ({
  getClient: jest.fn(),
  createQuery: jest.fn()
}))
jest.mock('@hcengineering/ui', () => ({
  getCurrentResolvedLocation: jest.fn(),
  locationToUrl: jest.fn()
}))
jest.mock('../filter', () => ({ filtersToQuery: jest.fn() }))

const association = {
  _id: 'assoc1',
  classA: 'test:class:Version',
  classB: 'test:class:ChangeRequest',
  nameA: 'Version',
  nameB: 'Change control',
  type: 'N:N'
} as unknown as Association

function mockClient (versionable: boolean): void {
  ;(getClient as jest.Mock).mockReturnValue({
    getHierarchy: () => ({
      classHierarchyMixin: () => (versionable ? {} : undefined)
    })
  })
}

describe('getRelationCandidatesClass', () => {
  it('picks the class of the requested side', () => {
    expect(getRelationCandidatesClass(association, 'B')).toBe('test:class:ChangeRequest')
    expect(getRelationCandidatesClass(association, 'A')).toBe('test:class:Version')
  })
})

describe('buildRelationCandidatesQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns an empty query for a non-versionable class without filters', async () => {
    mockClient(false)
    expect(await buildRelationCandidatesQuery(association, 'B')).toEqual({})
  })

  it('restricts to the latest version for versionable classes', async () => {
    mockClient(true)
    expect(await buildRelationCandidatesQuery(association, 'B')).toEqual({ isLatest: true })
  })

  it('excludes already linked documents', async () => {
    mockClient(true)
    expect(await buildRelationCandidatesQuery(association, 'B', ['d1', 'd2'] as any)).toEqual({
      isLatest: true,
      _id: { $nin: ['d1', 'd2'] }
    })
  })

  it('applies filterB for direction B', async () => {
    const stored = [{ key: { key: 'status' } }]
    mockClient(false)
    ;(filtersToQuery as jest.Mock).mockResolvedValue({ status: { $in: ['final'] } })

    const q = await buildRelationCandidatesQuery({ ...association, filterB: JSON.stringify(stored) } as any, 'B')

    expect(filtersToQuery as jest.Mock).toHaveBeenCalledWith(stored, {})
    expect(q).toEqual({ status: { $in: ['final'] } })
  })

  it('applies filterA for direction A and ignores filterB', async () => {
    const storedA = [{ key: { key: 'state' } }]
    mockClient(false)
    ;(filtersToQuery as jest.Mock).mockResolvedValue({ state: { $in: ['active'] } })

    await buildRelationCandidatesQuery(
      { ...association, filterA: JSON.stringify(storedA), filterB: JSON.stringify([{ key: { key: 'other' } }]) } as any,
      'A'
    )

    expect(filtersToQuery as jest.Mock).toHaveBeenCalledWith(storedA, {})
  })

  it('ignores a malformed filter without throwing', async () => {
    mockClient(true)
    const q = await buildRelationCandidatesQuery({ ...association, filterB: '{not json' } as any, 'B')
    expect(q).toEqual({ isLatest: true })
    expect(filtersToQuery as jest.Mock).not.toHaveBeenCalled()
  })
})

describe('commitPendingRelations', () => {
  it('writes each buffered relation with the new doc on the correct side', async () => {
    const createDoc = jest.fn(async () => 'rel')
    const ops = { createDoc } as any
    const pending: PendingRelation[] = [
      { association: 'assoc1' as any, direction: 'B', doc: 'card1' as any },
      { association: 'assoc2' as any, direction: 'A', doc: 'parent1' as any }
    ]

    await commitPendingRelations(ops, 'newDoc' as any, pending)

    expect(createDoc).toHaveBeenCalledTimes(2)
    expect(createDoc).toHaveBeenNthCalledWith(1, core.class.Relation, core.space.Workspace, {
      association: 'assoc1',
      docA: 'newDoc',
      docB: 'card1'
    })
    expect(createDoc).toHaveBeenNthCalledWith(2, core.class.Relation, core.space.Workspace, {
      association: 'assoc2',
      docA: 'parent1',
      docB: 'newDoc'
    })
  })

  it('does nothing when there is no selection', async () => {
    const createDoc = jest.fn()
    await commitPendingRelations({ createDoc } as any, 'newDoc' as any, [])
    expect(createDoc).not.toHaveBeenCalled()
  })
})
