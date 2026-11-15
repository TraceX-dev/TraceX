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

import card from '@hcengineering/card'
import core, { type Class, type Doc, type Ref } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { compileProcessYaml, type AuthoringNativeDocument } from '@hcengineering/process'
import { exportModule, exportModulePackageSource } from '../exporter'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn()
}))

interface ExportModelMock {
  findObject: (id: string) => AuthoringNativeDocument | undefined
  findAllSync: (clazz: string, query: Record<string, unknown>) => AuthoringNativeDocument[]
}

interface ExportHierarchyMock {
  getClass: (id: string) => AuthoringNativeDocument
  isDerived: (id: string, parent: string) => boolean
  getDescendants: (id: string) => string[]
  getOwnAttributes: (id: string) => Map<string, AuthoringNativeDocument>
}

interface ExportClientMock {
  getModel: () => ExportModelMock
  getHierarchy: () => ExportHierarchyMock
}

interface ExportExtensionResultMock {
  docs: AuthoringNativeDocument[]
  required: string[]
}

const source = `version: 2
kind: card
cardTypes:
  base: {extends: card:class:Card}
  root:
    extends: base
    fields:
      root_ref: {name: reference, type: {ref: reference_dependency}}
      root_array: {name: references, type: {array: {ref: array_dependency}}}
  child: {extends: root}
  grandchild: {extends: child}
  other_branch: {extends: root}
  sibling: {extends: base}
  reference_dependency:
    extends: card:class:Card
    fields:
      dependency_ref: {name: dependency, type: {ref: transitive_dependency}}
      dependency_status: {name: status, type: {enum: dependency_enum}}
  reference_child: {extends: reference_dependency}
  array_dependency: {extends: card:class:Card}
  array_child: {extends: array_dependency}
  association_base: {extends: card:class:Card}
  association_dependency: {extends: association_base}
  association_child: {extends: association_dependency}
  process_dependency: {extends: card:class:Card}
  process_child: {extends: process_dependency}
  child_dependency: {extends: card:class:Card}
  transitive_dependency:
    extends: card:class:Card
    fields:
      cycle_ref: {name: root, type: {ref: root}}
  unrelated: {extends: card:class:Card}
tags:
  child_tag:
    extends: child
    fields:
      tag_note: {name: note, type: string}
enums:
  dependency_enum: {name: Status, enumValues: [Open, Closed]}
relations:
  root_relation: {classA: root, classB: association_dependency, nameA: Roots, nameB: Dependencies, type: N:N}
  inbound_relation: {classA: reference_dependency, classB: root, nameA: References, nameB: Roots, type: N:N}
  child_relation: {classA: child, classB: child_dependency, nameA: Children, nameB: Dependencies, type: N:N}
  dependency_relation: {classA: association_dependency, classB: unrelated, nameA: Dependencies, nameB: Other, type: N:N}
  parent_relation: {classA: base, classB: unrelated, nameA: Bases, nameB: Other, type: N:N}
processes:
  root_workflow:
    label: Root workflow
    masterTag: root
    states:
      root_done: {label: Done}
  dependency_workflow:
    label: Dependency workflow
    masterTag: association_dependency
    states:
      dependency_done: {label: Done}
`

function setup (): AuthoringNativeDocument[] {
  const docs = compileProcessYaml(source).docs
  const extension: AuthoringNativeDocument = {
    _id: 'process_export',
    _class: card.class.ExportExtension,
    space: core.space.Model,
    func: 'process:function:ExportProcess'
  }
  const model: ExportModelMock = {
    findObject: (id) => docs.find((doc) => doc._id === id),
    findAllSync: (clazz, query) =>
      clazz === card.class.ExportExtension
        ? [extension]
        : docs.filter(
            (doc) => doc._class === clazz && Object.entries(query).every(([key, value]) => doc[key] === value)
          )
  }
  const hierarchy: ExportHierarchyMock = {
    getClass: (id) => {
      const doc = model.findObject(id)
      if (doc === undefined) throw new Error(`Unknown class: ${id}`)
      return doc
    },
    isDerived: (id, parent) => {
      let current: string | undefined = id
      while (current !== undefined) {
        if (current === parent) return true
        const base: unknown = model.findObject(current)?.extends
        current = typeof base === 'string' ? base : undefined
      }
      return false
    },
    getDescendants: (id) =>
      docs
        .filter(
          (doc) =>
            (doc._class === card.class.MasterTag || doc._class === card.class.Tag) && hierarchy.isDerived(doc._id, id)
        )
        .map((doc) => doc._id),
    getOwnAttributes: (id) =>
      new Map(
        docs
          .filter((doc) => doc._class === core.class.Attribute && doc.attributeOf === id)
          .map((doc) => [String(doc.name), doc])
      )
  }
  const client: ExportClientMock = {
    getModel: () => model,
    getHierarchy: () => hierarchy
  }
  ;(getClient as jest.Mock).mockReturnValue(client)
  ;(getResource as jest.Mock).mockResolvedValue((id: string): ExportExtensionResultMock => {
    const processes = new Set(docs.filter((doc) => doc.masterTag === id).map((doc) => doc._id))
    return {
      docs: docs.filter((doc) => processes.has(doc._id) || processes.has(String(doc.process))),
      required: id === 'root' ? ['process_dependency'] : []
    }
  })
  return docs
}

function typeRef (id: string): Ref<Class<Doc>> {
  return id as Ref<Class<Doc>>
}

function typeIds (docs: AuthoringNativeDocument[]): string[] {
  return docs
    .filter((doc) => doc._class === card.class.MasterTag || doc._class === card.class.Tag)
    .map((doc) => doc._id)
    .sort()
}

describe('card module export dependencies', () => {
  it.each(['json', 'yaml'] as const)(
    'exports the selected subtree and required definitions without expanding dependency modules in %s',
    async (format) => {
      const docs = setup()
      const before = JSON.stringify(docs)
      const source = await exportModule(typeRef('root'), format)
      const exported: AuthoringNativeDocument[] =
        format === 'json' ? JSON.parse(source) : compileProcessYaml(source).docs
      expect(typeIds(exported)).toEqual(
        [
          'base',
          'root',
          'child',
          'grandchild',
          'other_branch',
          'child_tag',
          'reference_dependency',
          'array_dependency',
          'association_base',
          'association_dependency',
          'process_dependency',
          'child_dependency',
          'transitive_dependency'
        ].sort()
      )
      expect(
        exported
          .filter((doc) => doc._class === core.class.Association)
          .map((doc) => doc._id)
          .sort()
      ).toEqual(['child_relation', 'inbound_relation', 'root_relation'])
      expect(exported.map((doc) => doc._id)).toEqual(
        expect.arrayContaining([
          'root_ref',
          'root_array',
          'dependency_ref',
          'cycle_ref',
          'dependency_enum',
          'dependency_status',
          'tag_note',
          'root_workflow',
          'root_done',
          'dependency_workflow',
          'dependency_done'
        ])
      )
      expect(new Set(exported.map((doc) => doc._id)).size).toBe(exported.length)
      expect(JSON.stringify(docs)).toBe(before)
    }
  )

  it('includes ancestors without their sibling branches or associations when exporting a nested type', async () => {
    setup()
    const exported = compileProcessYaml(await exportModule(typeRef('child'), 'yaml')).docs
    expect(typeIds(exported)).toEqual(
      [
        'base',
        'root',
        'child',
        'grandchild',
        'child_tag',
        'reference_dependency',
        'array_dependency',
        'process_dependency',
        'child_dependency',
        'transitive_dependency'
      ].sort()
    )
    expect(exported.filter((doc) => doc._class === core.class.Association).map((doc) => doc._id)).toEqual([
      'child_relation'
    ])
  })

  it.each([false, true])(
    'fully exports explicit package members regardless of dependency order: reverse=%p',
    async (reverse) => {
      setup()
      const ids = ['root', 'association_dependency']
      if (reverse) ids.reverse()
      const exported = compileProcessYaml(await exportModulePackageSource(ids.map(typeRef))).docs
      expect(typeIds(exported)).toContain('association_child')
      expect(typeIds(exported)).toContain('grandchild')
      expect(typeIds(exported)).toContain('unrelated')
      expect(exported.map((doc) => doc._id)).toContain('dependency_relation')
      expect(exported.map((doc) => doc._id)).not.toContain('parent_relation')
      expect(new Set(exported.map((doc) => doc._id)).size).toBe(exported.length)
    }
  )
})
