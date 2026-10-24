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

import card from '@hcengineering/card'
import core, { type Class, type Doc, type Ref } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { compileProcessYaml, type AuthoringNativeDocument } from '@hcengineering/process'
import view from '@hcengineering/view'
import { exportModule } from '../exporter'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn()
}))

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')

function expectEquivalentModel (actual: AuthoringNativeDocument[], expected: AuthoringNativeDocument[]): void {
  const values = (docs: AuthoringNativeDocument[]): unknown[] =>
    docs.map(({ rank, ...doc }) => doc).sort((a, b) => a._id.localeCompare(b._id))
  expect(values(actual)).toEqual(values(expected))
  const groups = new Map<string, AuthoringNativeDocument[]>()
  for (const doc of expected) {
    if (typeof doc.rank !== 'string') continue
    const key = [doc._class, doc.process ?? doc.attributeOf ?? doc.extends ?? '', doc.from ?? ''].join(':')
    const group = groups.get(key) ?? []
    group.push(doc)
    groups.set(key, group)
  }
  const ranks = new Map(actual.map((doc) => [doc._id, String(doc.rank)]))
  for (const docs of groups.values()) {
    for (const left of docs) {
      for (const right of docs) {
        if (String(left.rank) < String(right.rank)) {
          expect(String(ranks.get(left._id)) < String(ranks.get(right._id))).toBe(true)
        }
      }
    }
  }
}

function setup (): { id: Ref<Class<Doc>>, docs: Array<Record<string, unknown>> } {
  const definition = compileProcessYaml(
    readFileSync(`${__dirname}/../../../process/docs/examples/risk-management.card.yaml`, 'utf8')
  )
  const docs = definition.docs as Array<Record<string, unknown>>
  const id = docs.find((doc) => doc._class === card.class.MasterTag)?._id as Ref<Class<Doc>>
  ;(getResource as jest.Mock).mockResolvedValue(() => ({
    docs: docs.filter((doc) => String(doc._class).startsWith('process:')),
    required: []
  }))
  ;(getClient as jest.Mock).mockReturnValue({
    getHierarchy: () => ({
      getClass: () => ({ extends: card.class.Card }),
      isDerived: (clazz: string, parent: string) => clazz === parent,
      getDescendants: () => [id],
      getOwnAttributes: () =>
        new Map(docs.filter((doc) => doc._class === core.class.Attribute).map((doc) => [doc.name, doc]))
    }),
    getModel: () => ({
      findObject: (id: string) => docs.find((doc) => doc._id === id),
      findAllSync: (_class: string, query: Record<string, unknown>) =>
        _class === card.class.ExportExtension
          ? [{ func: 'process:function:ExportProcess' }]
          : docs.filter(
              (doc) => doc._class === _class && Object.entries(query).every(([key, value]) => doc[key] === value)
            )
    })
  })
  return { id, docs }
}

describe('card module export formats', () => {
  it('keeps JSON as the default and exports a reimportable YAML risk module', async () => {
    const { id } = setup()
    const json = await exportModule(id)
    expect(await exportModule(id, 'json')).toBe(json)
    const yaml = await exportModule(id, 'yaml')
    const result = compileProcessYaml(yaml)
    expect(result.kind).toBe('card')
    expect(result.docs).toHaveLength(JSON.parse(json).length)
    expect(result.version).toBe(2)
    expect(yaml).toContain('cardTypes:')
    expect(yaml).toContain('Multiply')
  })

  it('preserves presentation settings in YAML without mutating the model during JSON export', async () => {
    const { id, docs } = setup()
    const master = docs.find((doc) => doc._id === id)
    Object.assign(master ?? {}, { icon: view.ids.IconWithEmoji, color: '⚠️', background: 7 })
    expect(JSON.parse(await exportModule(id)).find((doc: Record<string, unknown>) => doc._id === id).icon).toBe(
      card.icon.Card
    )
    const result = compileProcessYaml(await exportModule(id, 'yaml'))
    expect(result.docs.find((doc) => doc._class === card.class.MasterTag)).toEqual(
      expect.objectContaining({ icon: view.ids.IconWithEmoji, color: '⚠️', background: 7 })
    )
    expect(master?.icon).toBe(view.ids.IconWithEmoji)
  })

  it('retains permission documents in YAML and JSON', async () => {
    const { id, docs } = setup()
    docs.push({ _id: 'permission', _class: core.class.ClassPermission, space: core.space.Model, targetClass: id })
    expect(JSON.parse(await exportModule(id)).some((doc: Record<string, unknown>) => doc._id === 'permission')).toBe(
      true
    )
    const yaml = await exportModule(id, 'yaml')
    expect(compileProcessYaml(yaml).version).toBe(2)
    expectEquivalentModel(compileProcessYaml(yaml).docs, JSON.parse(await exportModule(id)))
  })
})
