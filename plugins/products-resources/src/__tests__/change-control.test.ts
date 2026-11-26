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

import { type AccountUuid, type Association, type Client, type Ref, type Relation } from '@hcengineering/core'
import products, { ProductVersionState, type ProductVersion } from '@hcengineering/products'

import {
  canChangeProductVersionChangeControl,
  getProductVersionCardAssociation,
  getProductVersionCardAssociations,
  getProductVersionRelationQuery,
  getRelatedCard
} from '../change-control'

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
    const unrelated: Association = { ...forward, classB: products.class.Product }
    const automated: Association = { ...forward, automationOnly: true }
    const unnamed: Association = { ...forward, nameB: '' }

    expect(getProductVersionCardAssociations(mockClient([unrelated, automated, unnamed]))).toEqual([])
  })

  it('resolves only a compatible configured relation', () => {
    const client = mockClient([forward])
    expect(getProductVersionCardAssociation(client, forward._id)?.association).toBe(forward)
    expect(getProductVersionCardAssociation(client, 'missing' as Association['_id'])).toBeUndefined()
  })
})

describe('canChangeProductVersionChangeControl', () => {
  const owner = 'owner' as AccountUuid
  const member = 'member' as AccountUuid
  const product = { owners: [owner] }
  const active = { state: ProductVersionState.Active, readonly: false }
  const released = { state: ProductVersionState.Released, readonly: true }

  it('allows the product owner and members with a product role that updates the product', () => {
    expect(canChangeProductVersionChangeControl(active, product, owner, false)).toBe(true)
    expect(canChangeProductVersionChangeControl(active, product, member, true)).toBe(true)
  })

  it('denies other members', () => {
    expect(canChangeProductVersionChangeControl(active, product, member, false)).toBe(false)
    expect(canChangeProductVersionChangeControl(active, undefined, owner, true)).toBe(false)
  })

  it('denies previous versions', () => {
    expect(canChangeProductVersionChangeControl(released, product, owner, true)).toBe(false)
    expect(
      canChangeProductVersionChangeControl({ state: ProductVersionState.Active, readonly: true }, product, owner, true)
    ).toBe(false)
  })
})

describe('change control relation of a product version', () => {
  const version = 'version' as Ref<ProductVersion>
  const relation = { docA: version, docB: 'card', association: 'forward' } as unknown as Relation
  const reversed = { docA: 'card', docB: version, association: 'reverse' } as unknown as Relation

  it('finds the relation and the card on the right side', () => {
    expect(getProductVersionRelationQuery({ association: forward, direction: 'B' }, version)).toEqual({
      association: 'forward',
      docA: version
    })
    expect(getProductVersionRelationQuery({ association: reverse, direction: 'A' }, version)).toEqual({
      association: 'reverse',
      docB: version
    })
    expect(getRelatedCard({ association: forward, direction: 'B' }, relation)).toBe('card')
    expect(getRelatedCard({ association: reverse, direction: 'A' }, reversed)).toBe('card')
  })
})
