// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import core from '@hcengineering/core'
import process from '@hcengineering/process'
import { mergeDefinitionPackageComponents, type DefinitionPackageComponent } from '../definition-package-model'

function field (values: Record<string, unknown>, order = 0): DefinitionPackageComponent {
  return {
    key: 'field',
    class: core.class.Attribute,
    documents: {
      field: { document: { _id: 'field', _class: core.class.Attribute, ...values }, order }
    }
  }
}

describe('definition package three-way merge', () => {
  it('merges independent properties and preserves workspace-only properties', () => {
    const base = field({ label: 'Amount', type: { _class: core.class.TypeNumber } })
    const local = field({ label: 'Amount', type: { _class: core.class.TypeString }, workspaceOnly: false })
    const incoming = field({ label: 'Total', type: { _class: core.class.TypeNumber }, required: true })
    const snapshot = JSON.stringify([base, local, incoming])
    const result = mergeDefinitionPackageComponents(base, local, incoming)
    expect(result.conflictPaths).toEqual([])
    expect(result.component?.documents.field.document).toMatchObject({
      label: 'Total',
      type: { _class: core.class.TypeString },
      workspaceOnly: false,
      required: true
    })
    expect(JSON.stringify([base, local, incoming])).toBe(snapshot)
  })

  it('asks only for an overlapping incompatible value, retaining independent changes for either choice', () => {
    const base = field({ label: 'Amount' })
    const local = field({ label: 'Local amount', hidden: true })
    const incoming = field({ label: 'Published amount', readonly: true })
    for (const choice of ['local', 'upstream'] as const) {
      const result = mergeDefinitionPackageComponents(base, local, incoming, choice)
      expect(result.conflictPaths).toEqual(['$.documents.field.document.label'])
      expect(result.component?.documents.field.document).toMatchObject({
        label: choice === 'local' ? 'Local amount' : 'Published amount',
        hidden: true,
        readonly: true
      })
    }
  })

  it('does not mistake schema position shifts caused by field insertion for incompatible edits', () => {
    expect(
      mergeDefinitionPackageComponents(field({ label: 'A' }, 0), field({ label: 'A' }, 1), field({ label: 'B' }, 2))
        .conflictPaths
    ).toEqual([])
  })

  it('retains process branch order and action arrays as meaningful atomic values', () => {
    const base = field({ actions: ['a', 'b'] })
    base.class = process.class.Process
    const local = structuredClone(base)
    local.documents.field.document.actions = ['b', 'a']
    local.documents.field.order = 1
    const incoming = structuredClone(base)
    incoming.documents.field.document.actions = ['a', 'c', 'b']
    incoming.documents.field.order = 2
    expect(mergeDefinitionPackageComponents(base, local, incoming).conflictPaths).toEqual([
      '$.documents.field.document.actions',
      '$.documents.field.order'
    ])
  })

  it('distinguishes a delete/modify conflict from an unchanged deletion or a new field', () => {
    const base = field({ label: 'Amount' })
    expect(mergeDefinitionPackageComponents(base, undefined, field({ label: 'Total' })).conflictPaths).toEqual(['$'])
    expect(mergeDefinitionPackageComponents(base, base, undefined)).toEqual({ component: undefined, conflictPaths: [] })
    expect(mergeDefinitionPackageComponents(undefined, undefined, base)).toEqual({ component: base, conflictPaths: [] })
  })

  it('keeps incompatible type records intact instead of combining their parameters', () => {
    const base = field({ type: { _class: core.class.TypeNumber } })
    const local = field({ type: { _class: core.class.RefTo, to: 'card-a' } })
    const incoming = field({ type: { _class: core.class.EnumOf, of: 'enum-b' } })
    const result = mergeDefinitionPackageComponents(base, local, incoming, 'upstream')
    expect(result.conflictPaths).toEqual(['$.documents.field.document.type'])
    expect(result.component?.documents.field.document.type).toEqual({ _class: core.class.EnumOf, of: 'enum-b' })
  })
})
