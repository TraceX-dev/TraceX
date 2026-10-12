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

import { getEmbeddedLabel } from '@hcengineering/platform'
import { dump, load } from 'js-yaml'
import { compileProcessYaml } from '../authoring'
import { exportAuthoringModel } from '../authoring-model'
import { expectEquivalentModel } from './authoring-test-utils'

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const example = (): string => readFileSync(`${__dirname}/../../docs/examples/approval.process.yaml`, 'utf8')

function withSlotLabel (label: string): string {
  return example().replace('label: Approvers', `label: ${JSON.stringify(label)}`)
}

describe('readable localized labels in YAML v2', () => {
  it('embeds slot display text on import and removes the prefix on export', () => {
    const compiled = compileProcessYaml(example())
    expect(compiled.docs[0].requiredSlots).toEqual(expect.objectContaining({
      approvers: expect.objectContaining({ label: getEmbeddedLabel('Approvers') }),
      approved_tag: expect.objectContaining({ label: getEmbeddedLabel('Approved') })
    }))
    const source = exportAuthoringModel(compiled.docs, 'process')
    expect(source).toContain('label: Approvers')
    expect(source).not.toContain('embedded:embedded:')
    expectEquivalentModel(compileProcessYaml(source).docs, compiled.docs)
  })

  it('normalizes the known localized model labels while preserving ordinary graph names', () => {
    const compiled = compileProcessYaml(dump({
      version: 2,
      kind: 'card',
      cardTypes: { purchase: { label: 'Purchase', extends: 'card:class:Card', kind: 0 } },
      tags: { details: { label: 'Details', extends: 'purchase', kind: 2 } },
      fields: { amount: { label: 'Amount', attributeOf: 'purchase', name: 'amount', type: 'number' } },
      permissions: { read: { label: 'Read purchases', targetClass: 'purchase' } },
      attributePermissions: { update_amount: { label: 'Update amount', attribute: 'amount' } },
      processes: {
        review: {
          label: 'Review purchase',
          masterTag: 'purchase',
          start: { begin: { to: 'done', on: 'OnExecutionStart' } },
          states: { done: { label: 'Reviewed' } }
        }
      }
    }))
    const expected = new Map([
      ['purchase', 'Purchase'],
      ['details', 'Details'],
      ['amount', 'Amount'],
      ['read', 'Read purchases'],
      ['update_amount', 'Update amount']
    ])
    for (const [id, label] of expected) {
      expect(compiled.docs.find((doc) => doc._id === id)?.label).toBe(getEmbeddedLabel(label))
    }
    expect(compiled.docs.find((doc) => doc._id === 'review')?.name).toBe('Review purchase')
    expect(compiled.docs.find((doc) => doc._id === 'done')?.title).toBe('Reviewed')
    const source = exportAuthoringModel(compiled.docs, 'card')
    expect(source).not.toContain('embedded:embedded:')
    expectEquivalentModel(compileProcessYaml(source).docs, compiled.docs)
  })

  it.each([
    'plugin:string:Approvers',
    'custom:bundle:Approvers',
    'embedded:embedded:Approvers',
    'embedded:embedded:plugin:string:Approvers',
    'embedded:embedded:embedded:embedded:Approvers',
    'embedded:embedded:',
    'embedded:embedded:Price: USD',
    'embedded:embedded:Согласующие'
  ])('preserves the native identity %s during a round trip', (label) => {
    const compiled = compileProcessYaml(withSlotLabel(label))
    expect((compiled.docs[0].requiredSlots as Record<string, { label: string }>).approvers.label).toBe(label)
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(compiled.docs, 'process')).docs, compiled.docs)
  })

  it.each(['', 'Price: USD', 'Согласующие'])('embeds literal display text %s', (label) => {
    const compiled = compileProcessYaml(withSlotLabel(label))
    expect((compiled.docs[0].requiredSlots as Record<string, { label: string }>).approvers.label).toBe(getEmbeddedLabel(label))
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(compiled.docs, 'process')).docs, compiled.docs)
  })

  it('preserves old unqualified native labels through the native escape and native-list import', () => {
    const docs = compileProcessYaml(example()).docs
    ;(docs[0].requiredSlots as Record<string, { label: string }>).approvers.label = 'Legacy approvers'
    const source = exportAuthoringModel(docs, 'process')
    const layout = load(source) as {
      processes: { approval_process: { slots: { approvers: { label?: string, native: { label: string } } } } }
    }
    expect(layout.processes.approval_process.slots.approvers.label).toBeUndefined()
    expect(layout.processes.approval_process.slots.approvers.native.label).toBe('Legacy approvers')
    expectEquivalentModel(compileProcessYaml(source).docs, docs)
    expect(compileProcessYaml(dump({ version: 2, kind: 'process', model: docs })).docs).toEqual(docs)
  })
})
