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
import products, {
  ChangeControlMode,
  DEFAULT_CHANGE_CONTROL_CATEGORY,
  type ProductsSettings
} from '@hcengineering/products'

import {
  getAllowedChangeControlAssociations,
  getProductVersionCardAssociation,
  getProductVersionCardAssociations,
  resolveProductChangeControl
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

function mockSettings (settings: Partial<ProductsSettings>): ProductsSettings {
  return { enabled: true, ...settings } as unknown as ProductsSettings
}

describe('getAllowedChangeControlAssociations', () => {
  it('returns only relations allowed in the settings, in settings order', () => {
    const client = mockClient([forward, reverse])
    const settings = mockSettings({ changeControlRelations: [reverse._id, 'missing' as Association['_id']] })

    expect(getAllowedChangeControlAssociations(client, settings)).toEqual([{ association: reverse, direction: 'A' }])
    expect(getAllowedChangeControlAssociations(client, undefined)).toEqual([])
  })
})

describe('resolveProductChangeControl', () => {
  const client = mockClient([forward, reverse])

  it('defaults to controlled documents with the default category', () => {
    expect(resolveProductChangeControl(client, {}, undefined)).toEqual({
      mode: ChangeControlMode.ControlledDocument,
      inherited: true,
      category: DEFAULT_CHANGE_CONTROL_CATEGORY
    })
  })

  it('inherits the workspace mode, category and default relation', () => {
    const settings = mockSettings({
      changeControlMode: ChangeControlMode.Cards,
      changeControlCategory: 'category' as any,
      changeControlRelations: [forward._id, reverse._id],
      defaultChangeControlRelation: reverse._id
    })

    expect(resolveProductChangeControl(client, {}, settings)).toEqual({
      mode: ChangeControlMode.Cards,
      inherited: true,
      category: 'category',
      association: { association: reverse, direction: 'A' }
    })
  })

  it('uses the product override', () => {
    const settings = mockSettings({
      changeControlMode: ChangeControlMode.Cards,
      changeControlRelations: [forward._id, reverse._id],
      defaultChangeControlRelation: reverse._id
    })

    expect(
      resolveProductChangeControl(
        client,
        { changeControlMode: ChangeControlMode.Cards, changeControlRelation: forward._id },
        settings
      ).association
    ).toEqual({ association: forward, direction: 'B' })
    expect(
      resolveProductChangeControl(client, { changeControlMode: ChangeControlMode.ControlledDocument }, settings)
    ).toEqual({
      mode: ChangeControlMode.ControlledDocument,
      inherited: false,
      category: DEFAULT_CHANGE_CONTROL_CATEGORY
    })
  })

  it('does not resolve a relation that is not allowed in the workspace', () => {
    const settings = mockSettings({ changeControlRelations: [reverse._id] })

    const resolved = resolveProductChangeControl(
      client,
      { changeControlMode: ChangeControlMode.Cards, changeControlRelation: forward._id },
      settings
    )
    expect(resolved.mode).toBe(ChangeControlMode.Cards)
    expect(resolved.association).toBeUndefined()
  })
})
