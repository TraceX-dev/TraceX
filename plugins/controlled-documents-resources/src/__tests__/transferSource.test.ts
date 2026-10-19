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
import { resolveTransferSource } from '../transferSource'

jest.mock('@hcengineering/controlled-documents', () => ({
  __esModule: true,
  default: {
    class: {
      Document: 'doc',
      ProjectDocument: 'pjdoc',
      ProjectMeta: 'pjmeta',
      DocumentMeta: 'docmeta'
    }
  }
}))

const hierarchy = { isDerived: (c: string, base: string): boolean => c === base }

interface Row {
  _id: string
  _class: string
  [key: string]: any
}

function makeClient (rows: Row[]): { findAll: jest.Mock } {
  return {
    findAll: jest.fn(async (_class: string, query: any) => {
      return rows.filter((r) => {
        if (r._class !== _class) return false
        return Object.entries(query).every(([k, v]: [string, any]) =>
          v !== null && typeof v === 'object' && '$in' in v ? v.$in.includes(r[k]) : r[k] === v
        )
      })
    })
  }
}

const rows: Row[] = [
  { _id: 'm1', _class: 'docmeta' },
  { _id: 'm2', _class: 'docmeta' },
  { _id: 'pm1', _class: 'pjmeta', meta: 'm1' },
  { _id: 'pm2', _class: 'pjmeta', meta: 'm2' },
  // d1 (version 1) and d2 (version 2) belong to the same meta m1; d1 exists in two projects
  { _id: 'p1', _class: 'pjdoc', attachedTo: 'pm1', document: 'd1', project: 'old', space: 's1' },
  { _id: 'p2', _class: 'pjdoc', attachedTo: 'pm1', document: 'd1', project: 'new', space: 's1' },
  { _id: 'p3', _class: 'pjdoc', attachedTo: 'pm1', document: 'd2', project: 'new', space: 's1' },
  { _id: 'p4', _class: 'pjdoc', attachedTo: 'pm2', document: 'd3', project: 'new', space: 's1' }
]

const doc = (id: string, space = 's1'): any => ({ _id: id, _class: 'doc', space })

describe('resolveTransferSource', () => {
  it('uses the latest project for Document selection, not the first matching project document', async () => {
    const client = makeClient(rows)
    const res = await resolveTransferSource(client, hierarchy, [doc('d1')], async () => 'new' as any)
    expect(res).toEqual({ sourceDocumentIds: ['m1'], sourceSpaceId: 's1', sourceProjectId: 'new' })
  })

  it('de-duplicates meta ids shared by several document versions', async () => {
    const client = makeClient(rows)
    const res = await resolveTransferSource(
      client,
      hierarchy,
      [doc('d1'), doc('d2'), doc('d3')],
      async () => 'new' as any
    )
    expect(res?.sourceDocumentIds.sort()).toEqual(['m1', 'm2'])
  })

  it('takes the project from a ProjectDocument selection as is', async () => {
    const client = makeClient(rows)
    const pj: any = { ...rows.find((r) => r._id === 'p1') }
    const getLatest = jest.fn()
    const res = await resolveTransferSource(client, hierarchy, [pj], getLatest)
    expect(res).toEqual({ sourceDocumentIds: ['m1'], sourceSpaceId: 's1', sourceProjectId: 'old' })
    expect(getLatest).not.toHaveBeenCalled()
  })

  it('rejects selection spanning several spaces', async () => {
    const client = makeClient(rows)
    const res = await resolveTransferSource(client, hierarchy, [doc('d1'), doc('d3', 's2')], async () => 'new' as any)
    expect(res).toBeUndefined()
  })

  it('returns undefined when there is no project document in the latest project', async () => {
    const client = makeClient(rows)
    const res = await resolveTransferSource(client, hierarchy, [doc('d1')], async () => 'other' as any)
    expect(res).toBeUndefined()
  })

  it('returns undefined when the space has no available project or the selection is empty', async () => {
    const client = makeClient(rows)
    expect(await resolveTransferSource(client as any, hierarchy, [doc('d1')], async () => undefined)).toBeUndefined()
    expect(await resolveTransferSource(client as any, hierarchy, [], async () => 'new' as any)).toBeUndefined()
  })
})
