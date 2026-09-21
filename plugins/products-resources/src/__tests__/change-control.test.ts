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

import { type Association, type Client } from '@hcengineering/core'
import products from '@hcengineering/products'

import { getProductVersionCardAssociation, getProductVersionCardAssociations } from '../change-control'

const forward = {
  _id: 'forward',
  classA: products.class.ProductVersion,
  classB: 'card:class:ChangeRequest',
  nameA: 'Product version',
  nameB: 'Change request',
  type: 'N:N'
} as unknown as Association

const reverse = {
  _id: 'reverse',
  classA: 'card:class:CAPA',
  classB: products.class.ProductVersion,
  nameA: 'CAPA',
  nameB: 'Product version',
  type: 'N:N'
} as unknown as Association

function mockClient (associations: Association[]): Client {
  return {
    getHierarchy: () => ({
      getAncestors: () => [products.class.ProductVersion],
      isDerived: (_class: string) => _class.startsWith('card:class:')
    }),
    getModel: () => ({
      findAllSync: () => associations
    })
  } as unknown as Client
}

describe('getProductVersionCardAssociations', () => {
  it('returns card relations in both directions', () => {
    expect(getProductVersionCardAssociations(mockClient([forward, reverse]))).toEqual([
      { association: forward, direction: 'B' },
      { association: reverse, direction: 'A' }
    ])
  })

  it('excludes unrelated and automation-only relations', () => {
    const unrelated: Association = { ...forward, _id: 'unrelated', classB: 'contact:class:Person' }
    const automated: Association = { ...forward, _id: 'automated', automationOnly: true }
    const unnamed: Association = { ...forward, _id: 'unnamed', nameB: '' }

    expect(getProductVersionCardAssociations(mockClient([unrelated, automated, unnamed]))).toEqual([])
  })

  it('resolves only a compatible configured relation', () => {
    const client = mockClient([forward])
    expect(getProductVersionCardAssociation(client, forward._id)?.association).toBe(forward)
    expect(getProductVersionCardAssociation(client, 'missing' as Association['_id'])).toBeUndefined()
  })
})
