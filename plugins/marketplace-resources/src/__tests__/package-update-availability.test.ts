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

import core, { type Doc, type Hierarchy, type ModelDb, type Ref } from '@hcengineering/core'
import marketplace, {
  createDefinitionPackageRelease,
  prepareDefinitionPackageInstallation,
  prepareDefinitionPackageUpdate,
  type DefinitionPackageInstallation
} from '@hcengineering/marketplace'
import { packageUpdateCanApply, packageUpdateDifferences, packageUpdateNeedsResolution } from '../package-update-review'

const source = `version: 2
kind: card
cardTypes:
  purchase:
    label: Purchase
    extends: card:class:Card
    kind: 0
    fields:
      amount: {name: stored_amount, label: Amount, type: number}
`

async function workspace (): Promise<{
  docs: Doc[]
  model: ModelDb
  hierarchy: Hierarchy
  installation: DefinitionPackageInstallation
}> {
  const docs: Doc[] = []
  const modelMock: {
    findObject: (id: string) => Doc | undefined
    findAllSync: (clazz: string, query: Record<string, unknown>) => Doc[]
  } = {
    findObject: (id) => docs.find((doc) => doc._id === id),
    findAllSync: (clazz, query) =>
      docs.filter(
        (doc) => doc._class === clazz && Object.entries(query).every(([key, value]) => Reflect.get(doc, key) === value)
      )
  }
  const hierarchyMock: Pick<Hierarchy, 'isDerived' | 'findAttribute'> = {
    isDerived: (actual, expected) => actual === expected,
    findAttribute: () => undefined
  }
  const model = modelMock as unknown as ModelDb
  const hierarchy = hierarchyMock as Hierarchy
  const base = await createDefinitionPackageRelease({ package: { id: 'test/update', version: '1.0.0' }, source })
  const prepared = await prepareDefinitionPackageInstallation(
    base,
    {},
    'installation' as Ref<DefinitionPackageInstallation>,
    model,
    hierarchy
  )
  docs.push(...prepared.documents)
  const installation: DefinitionPackageInstallation = {
    _id: 'installation' as Ref<DefinitionPackageInstallation>,
    _class: marketplace.class.DefinitionPackageInstallation,
    space: core.space.Configuration,
    modifiedOn: 0,
    modifiedBy: core.account.System,
    ...prepared.installation
  }
  return { docs, model, hierarchy, installation }
}

describe('package update button with native update previews', () => {
  it.each([
    'type: string',
    'type: string, required: true',
    'type: number, hidden: true, readonly: true, automationOnly: true',
    'type: {class: extension.CustomType}'
  ])('enables Update for field additions without choices: %s', async (properties) => {
    const { docs, model, hierarchy, installation } = await workspace()
    Object.assign(docs.find((doc) => doc._id === installation.identities.amount) ?? {}, {
      hidden: false,
      workspaceSetting: 'preserve me'
    })
    const incoming = await createDefinitionPackageRelease({
      package: { id: 'test/update', version: '1.0.1' },
      source:
        source.replace('label: Amount', 'label: Total') +
        `      comment: {name: comment, label: Comment, ${properties}}\n`
    })
    const preview = await prepareDefinitionPackageUpdate(installation, incoming, {}, {}, model, hierarchy)
    expect(preview.blocked).toBe(false)
    expect(packageUpdateCanApply(preview, false, false)).toBe(true)
    expect(
      preview.changes.some((change) =>
        packageUpdateNeedsResolution(change, preview.missingDependencies, preview.blockedChanges.includes(change.key))
      )
    ).toBe(false)
    expect(preview.documents.find((doc) => doc._id === installation.identities.amount)).toMatchObject({
      label: 'embedded:embedded:Total',
      hidden: false,
      workspaceSetting: 'preserve me'
    })
  })

  it('enables Update after either choice for a real conflict and keeps independent field additions', async () => {
    const { docs, model, hierarchy, installation } = await workspace()
    const key = installation.identities.amount
    Object.assign(docs.find((doc) => doc._id === key) ?? {}, { label: 'embedded:embedded:Local amount', hidden: true })
    const incoming = await createDefinitionPackageRelease({
      package: { id: 'test/update', version: '1.0.1' },
      source:
        source.replace('label: Amount', 'label: Total') +
        '      comment: {name: comment, label: Comment, type: string}\n'
    })
    const unresolved = await prepareDefinitionPackageUpdate(installation, incoming, {}, {}, model, hierarchy)
    expect(packageUpdateCanApply(unresolved, false, false)).toBe(false)
    expect(unresolved.changes.find((change) => change.key === key)?.conflictPaths).toEqual([
      `$.documents.${key}.document.label`
    ])
    const conflictRows = packageUpdateDifferences(
      unresolved.reviewComponents[key],
      'incoming',
      unresolved.changes.find((change) => change.key === key)?.conflictPaths
    )
    expect(conflictRows.flatMap((doc) => doc.properties).map((property) => property.key)).toEqual(['label'])
    for (const choice of ['local', 'upstream'] as const) {
      const preview = await prepareDefinitionPackageUpdate(
        installation,
        incoming,
        {},
        { [key]: choice },
        model,
        hierarchy
      )
      expect(packageUpdateCanApply(preview, false, false)).toBe(true)
      expect(preview.documents.find((doc) => doc._id === key)).toMatchObject({
        label: choice === 'local' ? 'embedded:embedded:Local amount' : 'embedded:embedded:Total',
        hidden: true
      })
      expect(preview.documents.some((doc) => doc._id === preview.installation.identities.comment)).toBe(true)
      expect(packageUpdateCanApply(preview, true, false)).toBe(false)
      expect(packageUpdateCanApply(preview, false, true)).toBe(false)
    }
  })
})
