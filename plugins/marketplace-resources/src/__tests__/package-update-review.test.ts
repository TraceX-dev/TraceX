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
import {
  type DefinitionPackageChange,
  type DefinitionPackageReviewComponents,
  type PreparedDefinitionPackageUpdate
} from '@hcengineering/marketplace'
import { getEmbeddedLabel } from '@hcengineering/platform'
import process from '@hcengineering/process'
import {
  packageUpdateDifferences,
  packageUpdateDocuments,
  packageUpdateNeedsResolution,
  packageUpdateStatus,
  packageUpdateVisibleChanges
} from '../package-update-review'

function component (documents: Record<string, unknown>[]): NonNullable<DefinitionPackageReviewComponents['local']> {
  return {
    key: 'process',
    class: process.class.Process,
    documents: Object.fromEntries(documents.map((document) => [String(document._id), { document }]))
  }
}

function change (resolution: DefinitionPackageChange['resolution']): DefinitionPackageChange {
  return {
    key: 'process',
    class: process.class.Process,
    operation: 'modified',
    resolution,
    impact: 'behavioral',
    paths: [],
    reason: '',
    ...(resolution === 'conflict' ? { conflictPaths: ['$.documents.process.document.name'] } : {})
  }
}

describe('package update review', () => {
  it('shows no diff for preserved local fields and asks no question for field additions', () => {
    const field = component([{ _id: 'process', _class: core.class.Attribute, label: getEmbeddedLabel('Local note') }])
    const review: DefinitionPackageReviewComponents = { local: field, target: field }
    const preview: Pick<
      PreparedDefinitionPackageUpdate,
      'changes' | 'reviewComponents' | 'missingDependencies' | 'blockedChanges'
    > = {
      changes: [{ ...change('local'), class: core.class.Attribute, operation: 'added' }],
      reviewComponents: { process: review },
      missingDependencies: false,
      blockedChanges: []
    }
    expect(packageUpdateVisibleChanges(preview)).toEqual([])
    expect(packageUpdateDifferences(review, 'target')).toEqual([])
    expect(packageUpdateNeedsResolution(preview.changes[0], false)).toBe(false)
    expect(packageUpdateNeedsResolution({ ...preview.changes[0], resolution: 'upstream' }, false)).toBe(false)
  })

  it('shows only the chosen workspace delta while retaining real conflicts and dependency restore choices', () => {
    const current = component([{ _id: 'process', _class: process.class.Process, name: 'Local review' }])
    const incoming = component([{ _id: 'process', _class: process.class.Process, name: 'Published review' }])
    const review: DefinitionPackageReviewComponents = { local: current, incoming, target: current }
    const preview: Pick<
      PreparedDefinitionPackageUpdate,
      'changes' | 'reviewComponents' | 'missingDependencies' | 'blockedChanges'
    > = {
      changes: [change('conflict')],
      reviewComponents: { process: review },
      missingDependencies: false,
      blockedChanges: []
    }
    expect(packageUpdateVisibleChanges(preview)).toHaveLength(1)
    expect(packageUpdateDifferences(review, 'target')).toEqual([])
    expect(packageUpdateDifferences(review, 'incoming')).toHaveLength(1)
    expect(packageUpdateNeedsResolution({ ...change('local'), operation: 'removed' }, true)).toBe(true)
    expect(packageUpdateNeedsResolution({ ...change('local'), operation: 'removed' }, false)).toBe(false)
  })

  it('distinguishes a real property removal from an omitted property on a preserved definition', () => {
    const current = component([
      { _id: 'process', _class: process.class.Process, name: 'Review', description: 'Local note' }
    ])
    const target = component([{ _id: 'process', _class: process.class.Process, name: 'Review' }])
    const review: DefinitionPackageReviewComponents = { local: current, incoming: target, target: current }
    expect(packageUpdateDifferences(review, 'target')).toEqual([])
    expect(packageUpdateDifferences({ ...review, target }, 'target')[0].properties).toEqual([
      { key: 'description', current: 'Local note', incoming: undefined }
    ])
  })

  it.each([
    ['merged', undefined, 'update'],
    ['upstream', undefined, 'update'],
    ['local', undefined, 'preserve'],
    ['conflict', undefined, 'decision'],
    ['converged', undefined, 'matches'],
    ['local', 'upstream', 'update'],
    ['conflict', 'upstream', 'update'],
    ['conflict', 'local', 'preserve'],
    ['local', 'local', 'preserve']
  ] as const)('describes the effective decision for %s / %s', (resolution, choice, expected) => {
    expect(packageUpdateStatus(change(resolution), choice)).toBe(expected)
  })

  it('compares the live workspace to the package rather than showing two unrelated baseline diffs', () => {
    const root = { _id: 'process', _class: process.class.Process, name: 'Review' }
    const review: DefinitionPackageReviewComponents = {
      baseline: component([{ ...root, description: 'Original' }]),
      local: component([{ ...root, description: 'Local' }]),
      incoming: component([{ ...root, description: 'Published' }])
    }
    expect(packageUpdateDifferences(review)).toEqual([
      {
        id: 'process',
        label: getEmbeddedLabel('Review'),
        class: process.class.Process,
        operation: 'modified',
        properties: [{ key: 'description', current: 'Local', incoming: 'Published' }]
      }
    ])
    expect(packageUpdateDocuments({ process: review }, 'local')[0].description).toBe('Local')
  })

  it('preserves removals, additions, null, missing values and action order', () => {
    const field = { _id: 'field', _class: core.class.Attribute, label: getEmbeddedLabel('Amount'), defaultValue: null }
    const root = { _id: 'process', _class: process.class.Process, name: 'Review' }
    const review: DefinitionPackageReviewComponents = {
      local: component([field, { ...root, actions: ['first', 'second'], value: null }]),
      incoming: component([
        { _id: 'new', _class: core.class.Attribute, label: getEmbeddedLabel('Date') },
        { ...root, actions: ['second', 'first'] }
      ])
    }
    const result = packageUpdateDifferences(review)
    expect(result.find((doc) => doc.id === 'field')?.operation).toBe('removed')
    expect(result.find((doc) => doc.id === 'new')?.operation).toBe('added')
    expect(result.find((doc) => doc.id === 'process')?.properties).toEqual([
      { key: 'actions', current: ['first', 'second'], incoming: ['second', 'first'] },
      { key: 'value', current: null, incoming: undefined }
    ])
    expect(result.flatMap((doc) => doc.properties).some((property) => property.key === '_id')).toBe(false)
  })

  it('names changed transitions using state titles even when states themselves have no changes', () => {
    const states = [
      { _id: 'opaque-a', _class: process.class.State, title: 'Waiting' },
      { _id: 'opaque-b', _class: process.class.State, title: 'Approved' }
    ]
    const transition = { _id: 'opaque-transition', _class: process.class.Transition, from: 'opaque-a', to: 'opaque-b' }
    const review: DefinitionPackageReviewComponents = {
      local: component([...states, { ...transition, actions: [] }]),
      incoming: component([...states, { ...transition, actions: ['new action'] }])
    }
    expect(packageUpdateDifferences(review)[0].label).toBe(getEmbeddedLabel('Waiting → Approved'))
    expect(packageUpdateDifferences({ local: review.local, incoming: review.local })).toEqual([])
  })

  it('includes normalized branch order changes without audit data or ranks', () => {
    const root = { _id: 'process', _class: process.class.Process, name: 'Review' }
    const local = component([root])
    const incoming = component([root])
    local.documents.process.order = 0
    incoming.documents.process.order = 1
    expect(packageUpdateDifferences({ local, incoming })[0].properties).toEqual([
      { key: '$order', current: 0, incoming: 1 }
    ])
  })
})
