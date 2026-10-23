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

/* eslint-disable no-template-curly-in-string -- Native expressions are intentionally literal test data. */

import { dump, load } from 'js-yaml'
import { compileProcessYaml } from '../authoring'
import { exportAuthoringModel } from '../authoring-model'
import {
  compareDefinitionPackageVersions,
  createDefinitionPackageRelease,
  parseDefinitionPackageRelease
} from '../definition-package'
import { planDefinitionPackageUpgrade } from '../definition-package-plan'
import type { DefinitionPackageRelease } from '../definition-package-types'

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const example = (file: string): string => readFileSync(`${__dirname}/../../docs/examples/${file}`, 'utf8')

interface CardFixture {
  version: number
  kind: string
  cardTypes: Record<
    string,
    {
      label: string
      extends: string
      kind: number
      fields: Record<string, Record<string, unknown>>
      native?: Record<string, unknown>
    }
  >
  enums?: Record<string, Record<string, unknown>>
  relations?: Record<string, Record<string, unknown>>
}

function card (): CardFixture {
  return {
    version: 2,
    kind: 'card',
    cardTypes: {
      purchase: {
        label: 'Purchase',
        extends: 'card:class:Card',
        kind: 0,
        fields: {
          amount: { name: 'amount', label: 'Amount', type: 'number', isCustom: true },
          notes: { name: 'notes', label: 'Notes', type: 'string', isCustom: true }
        }
      }
    }
  }
}

async function release (source: string, version = '1.0.0'): Promise<DefinitionPackageRelease> {
  return await createDefinitionPackageRelease({ package: { id: 'acme/procurement', version }, source })
}

beforeAll(() => {
  if (globalThis.crypto?.subtle === undefined) {
    const { webcrypto } = jest.requireActual<{ webcrypto: Crypto }>('node:crypto')
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
  }
})

describe('immutable definition package releases', () => {
  it.each(['procurement-workspace.card.yaml', 'purchase-approval.process.yaml'])(
    'packages and verifies the existing %s without changing its DSL',
    async (file) => {
      const source = example(file)
      const original = await release(source)
      expect(original.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
      const artifact = JSON.stringify({ package: original.package, source, contentHash: original.contentHash })
      expect((await parseDefinitionPackageRelease(artifact)).definition).toEqual(compileProcessYaml(source))
      expect(original.source).toBe(source)
    }
  )

  it('detects source tampering and ignores untrusted derived documents', async () => {
    const original = await release(dump(card()))
    await expect(
      createDefinitionPackageRelease({
        package: original.package,
        source: original.source + '\n# changed',
        contentHash: original.contentHash
      })
    ).rejects.toThrow('SHA-256 digest')
    const forged = { ...original, definition: { ...original.definition, docs: [] } }
    expect((await planDefinitionPackageUpgrade(original, forged)).status).toBe('unchanged')
  })

  it.each(['1', 'v1.2.3', '01.2.3', '1.2.3-01', '1.2.3+build..x', '1.2.3\n'])(
    'rejects the invalid release version %p',
    async (version) => {
      await expect(release(dump(card()), version)).rejects.toThrow('SemVer')
    }
  )

  it.each(['procurement', 'Acme/procurement', 'acme/../procurement', 'acme/procurement\n'])(
    'rejects the invalid package id %p',
    async (id) => {
      await expect(
        createDefinitionPackageRelease({ package: { id, version: '1.0.0' }, source: dump(card()) })
      ).rejects.toThrow('publisher-qualified')
    }
  )

  it('rejects unknown manifest contracts and invalid artifacts instead of accepting implied behavior', async () => {
    await expect(
      createDefinitionPackageRelease({
        package: { id: 'acme/procurement', version: '1.0.0', migrations: [] },
        source: dump(card())
      })
    ).rejects.toThrow('Unsupported property')
    await expect(parseDefinitionPackageRelease('version: 2')).rejects.toThrow('JSON release envelope')
    await expect(parseDefinitionPackageRelease(' '.repeat(3 * 1024 * 1024 + 1))).rejects.toThrow('3 MiB')
    await expect(release('version: 1')).rejects.toThrow('Only version: 2')
  })
})

describe('SemVer precedence', () => {
  it.each([
    ['1.0.0-alpha', '1.0.0-alpha.1'],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta'],
    ['1.0.0-alpha.beta', '1.0.0-beta'],
    ['1.0.0-beta.2', '1.0.0-beta.11'],
    ['1.0.0-rc.1', '1.0.0'],
    ['1.9.0', '1.10.0'],
    ['1.0.9007199254740992', '1.0.9007199254740993']
  ])('orders %s before %s without numeric precision loss', (a, b) => {
    expect(compareDefinitionPackageVersions(a, b)).toBe(-1)
    expect(compareDefinitionPackageVersions(b, a)).toBe(1)
  })

  it('ignores build metadata for precedence', () => {
    expect(compareDefinitionPackageVersions('1.2.3+abc', '1.2.3+def')).toBe(0)
  })
})

describe('read-only package upgrade analysis', () => {
  it('classifies a label change and an optional field as candidates without authorizing application', async () => {
    const base = await release(dump(card()))
    const incoming = card()
    incoming.cardTypes.purchase.label = 'Purchase order'
    incoming.cardTypes.purchase.fields.comment = { name: 'comment', type: 'markup', isCustom: true }
    const next = await release(dump(incoming), '1.1.0')
    const before = JSON.stringify([base, next])
    const plan = await planDefinitionPackageUpgrade(base, next)
    expect(plan.status).toBe('compatible-candidate')
    expect(plan.changes.map((change) => change.impact).sort()).toEqual(['additive', 'cosmetic'])
    expect(plan.reviewReasons).toContain('workspace-analysis-required')
    expect(plan.canAutoApply).toBe(false)
    expect(JSON.stringify([base, next])).toBe(before)
  })

  it.each(['required', 'type', 'name', 'default', 'remove', 'unknown'])(
    'requires review for a %s field change',
    async (problem) => {
      const base = await release(dump(card()))
      const incoming = card()
      const field = incoming.cardTypes.purchase.fields.amount
      if (problem === 'required') field.required = true
      if (problem === 'type') field.type = { ref: 'contact.mixin.Employee' }
      if (problem === 'name') field.name = 'total'
      if (problem === 'default') field.defaultValue = 1000
      if (problem === 'remove') delete incoming.cardTypes.purchase.fields.amount
      if (problem === 'unknown') field.unregisteredOption = true
      const plan = await planDefinitionPackageUpgrade(base, await release(dump(incoming), '1.0.1'))
      const change = plan.changes.find((change) => change.key === 'amount')
      expect(plan.status).toBe('review-required')
      expect(change?.impact).toBe(
        problem === 'unknown' ? 'unknown' : problem === 'default' ? 'behavioral' : 'destructive'
      )
    }
  )

  it('does not auto-approve new required fields even when the author calls the release a patch', async () => {
    const incoming = card()
    incoming.cardTypes.purchase.fields.code = { name: 'code', type: 'string', required: true }
    const plan = await planDefinitionPackageUpgrade(await release(dump(card())), await release(dump(incoming), '1.0.1'))
    expect(plan.changes.find((change) => change.key === 'code')?.impact).toBe('destructive')
  })

  it('requires review for display changes on fields with unsupported native type contracts', async () => {
    const baseline = card()
    baseline.cardTypes.purchase.fields.amount.type = { class: 'extension.UnverifiedType' }
    const incoming = structuredClone(baseline)
    incoming.cardTypes.purchase.fields.amount.label = 'New label'
    const plan = await planDefinitionPackageUpgrade(
      await release(dump(baseline)),
      await release(dump(incoming), '1.0.1')
    )
    expect(plan.changes.find((change) => change.key === 'amount')?.impact).toBe('unknown')
  })

  it('does not ignore transaction-looking metadata nested inside literal operation parameters', async () => {
    const { docs } = compileProcessYaml(example('review-task.process.yaml'))
    const first = docs.find((doc) => doc.from === null)
    const action = (first?.actions as Array<{ params: Record<string, unknown> }>)[0]
    action.params.payload = { modifiedOn: 1, values: ['first', 'second'] }
    const base = await release(dump({ version: 2, kind: 'process', model: docs }))
    action.params.payload = { modifiedOn: 2, values: ['first', 'second'] }
    const incoming = await release(dump({ version: 2, kind: 'process', model: docs }), '1.0.1')
    const plan = await planDefinitionPackageUpgrade(base, incoming)
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0].impact).toBe('behavioral')
  })

  it('preserves local-only additions/deletions and reports identical concurrent edits as converged', async () => {
    const baseline = card()
    const incoming = card()
    const local = card()
    incoming.cardTypes.purchase.fields.amount.label = 'Total'
    local.cardTypes.purchase.fields.amount.label = 'Total'
    delete local.cardTypes.purchase.fields.notes
    local.cardTypes.purchase.fields.local_field = { name: 'local_field', type: 'string' }
    const plan = await planDefinitionPackageUpgrade(
      await release(dump(baseline)),
      await release(dump(incoming), '1.0.1'),
      dump(local)
    )
    expect(plan.changes.map((change) => [change.key, change.resolution])).toEqual([
      ['amount', 'converged'],
      ['local_field', 'local'],
      ['notes', 'local']
    ])
    expect(plan.reviewReasons).toContain('local-customization')
  })

  it('reports divergent edits and delete/modify conflicts with concrete property paths', async () => {
    const incoming = card()
    const local = card()
    incoming.cardTypes.purchase.fields.amount.label = 'Incoming'
    local.cardTypes.purchase.fields.amount.label = 'Local'
    delete incoming.cardTypes.purchase.fields.notes
    local.cardTypes.purchase.fields.notes.label = 'Local notes'
    const plan = await planDefinitionPackageUpgrade(
      await release(dump(card())),
      await release(dump(incoming), '1.1.0'),
      dump(local)
    )
    expect(plan.status).toBe('conflict')
    expect(plan.changes.every((change) => change.resolution === 'conflict')).toBe(true)
    expect(plan.changes[0].paths).toContain('$.documents.amount.document.label')
  })

  it('treats the whole graph as one conflict unit instead of merging unrelated action changes', async () => {
    const source = example('purchase-approval.process.yaml')
    const upstream = source.replace('label:', 'label: Updated ')
    const local = source + '\n'
    const localDefinition = load(local) as { processes: Record<string, Record<string, unknown>> }
    Object.values(localDefinition.processes)[0].description = 'Locally modified behavior'
    const plan = await planDefinitionPackageUpgrade(
      await release(source),
      await release(upstream, '1.1.0'),
      dump(localDefinition)
    )
    expect(plan.status).toBe('conflict')
    expect(plan.changes).toHaveLength(1)
    expect(plan.reviewReasons).toContain('process-revisions-required')
  })

  it('detects branch/action reordering while ignoring regenerated ranks and runtime timestamps', async () => {
    const source = example('risk-management.card.yaml')
    const original = compileProcessYaml(source)
    const regenerated = original.docs.map((doc, index) => ({
      ...doc,
      ...(doc.rank === undefined ? {} : { rank: `rank-${String(index).padStart(5, '0')}` }),
      modifiedOn: 1234,
      modifiedBy: 'account'
    }))
    const normalized = dump({ version: 2, kind: 'card', model: regenerated })
    const baseline = await release(source)
    expect((await planDefinitionPackageUpgrade(baseline, await release(normalized, '1.0.1'))).changes).toEqual([])
    const transition = regenerated.find((doc) => doc._id === 'critical_risk')
    Object.assign(transition ?? {}, { rank: 'zzzz' })
    const reordered = await release(dump({ version: 2, kind: 'card', model: regenerated }), '1.0.2')
    expect((await planDefinitionPackageUpgrade(baseline, reordered)).changes).toEqual([
      expect.objectContaining({ key: 'risk_assessment', impact: 'behavioral' })
    ])
  })

  it('preserves array ordering and literal strings in operation parameters', async () => {
    const source = example('review-task.process.yaml')
    const { docs } = compileProcessYaml(source)
    const first = docs.find((doc) => doc.from === null)
    const actions = first?.actions as Array<Record<string, unknown>>
    actions.reverse()
    ;(actions[0].params as Record<string, unknown>).literal = {
      modifiedOn: 42,
      expression: '${@amount}',
      values: ['b', 'a']
    }
    const incoming = await release(exportAuthoringModel(docs, 'process'), '1.0.1')
    const plan = await planDefinitionPackageUpgrade(await release(source), incoming)
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0].impact).toBe('behavioral')
  })

  it('detects enum removal and relation cardinality changes', async () => {
    const baseline = card()
    baseline.enums = { decision: { name: 'Decision', enumValues: ['Approved', 'Rejected'] } }
    baseline.relations = { links: { classA: 'purchase', classB: 'purchase', nameA: 'A', nameB: 'B', type: 'N:N' } }
    const incoming = structuredClone(baseline)
    if (incoming.enums !== undefined) incoming.enums.decision.enumValues = ['Approved']
    if (incoming.relations !== undefined) incoming.relations.links.type = '1:1'
    const plan = await planDefinitionPackageUpgrade(
      await release(dump(baseline)),
      await release(dump(incoming), '1.1.0')
    )
    expect(plan.changes.map((change) => change.impact)).toEqual(['destructive', 'destructive'])
  })

  it('requires review for major/prerelease upgrades and rejects downgrade, replacement and identity changes', async () => {
    const source = dump(card())
    const baseline = await release(source)
    expect((await planDefinitionPackageUpgrade(baseline, await release(source, '2.0.0'))).reviewReasons).toContain(
      'major-release'
    )
    expect(
      (await planDefinitionPackageUpgrade(baseline, await release(source, '1.1.0-beta.1'))).reviewReasons
    ).toContain('prerelease')
    await expect(planDefinitionPackageUpgrade(baseline, await release(source, '0.9.0'))).rejects.toThrow('Downgrades')
    await expect(planDefinitionPackageUpgrade(baseline, await release(source + '\n'))).rejects.toThrow(
      'same SemVer precedence'
    )
    const other = await createDefinitionPackageRelease({
      package: { id: 'other/procurement', version: '1.1.0' },
      source
    })
    await expect(planDefinitionPackageUpgrade(baseline, other)).rejects.toThrow('different package')
    const process = await release(example('review-task.process.yaml'), '1.1.0')
    await expect(planDefinitionPackageUpgrade(baseline, process)).rejects.toThrow('definition kind')
    await expect(planDefinitionPackageUpgrade(baseline, baseline, process.source)).rejects.toThrow(
      'Local definition kind'
    )
  })
})
