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
import core from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import process, { exportAuthoringModel, type AuthoringNativeDocument } from '@hcengineering/process'
import { importModule } from '../exporter'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const source = readFileSync(`${__dirname}/../../../process/docs/examples/risk-management.card.yaml`, 'utf8')

function setup (existingDocs: AuthoringNativeDocument[] = []): {
  createDoc: jest.Mock
  updateDoc: jest.Mock
  commit: jest.Mock
} {
  const createDoc = jest.fn().mockResolvedValue(undefined)
  const updateDoc = jest.fn().mockResolvedValue(undefined)
  const commit = jest.fn().mockResolvedValue({ result: true })
  const registry = [
    ...Object.values(process.method).map((_id) => ({ _id, _class: process.class.Method })),
    ...Object.values(process.trigger).map((_id) => ({ _id, _class: process.class.Trigger })),
    ...Object.values(process.function).map((_id) => ({ _id, _class: process.class.ProcessFunction }))
  ]
  ;(getClient as jest.Mock).mockReturnValue({
    getHierarchy: () => ({ isDerived: () => false }),
    getModel: () => ({
      findObject: (id: string) => existingDocs.find((doc) => doc._id === id) ?? registry.find((doc) => doc._id === id)
    }),
    apply: () => ({ createDoc, updateDoc, commit })
  })
  return { createDoc, updateDoc, commit }
}

describe('YAML card module import', () => {
  describe.each(['json', 'yaml'] as const)('%s existing card type import', (format) => {
    const document: AuthoringNativeDocument = {
      _id: 'restored_type',
      _class: card.class.MasterTag,
      space: core.space.Model,
      extends: card.class.Card,
      kind: 0,
      rank: '0|hzzzzz:',
      label: 'embedded:embedded:Restored type'
    }

    it.each([undefined, true, false])('restores a deleted type when the imported removed flag is %s', async (removed) => {
      const existing: AuthoringNativeDocument = { ...document, removed: true }
      const imported: AuthoringNativeDocument = removed === undefined ? document : { ...document, removed }
      const { createDoc, updateDoc, commit } = setup([existing])
      const source = format === 'json' ? JSON.stringify([imported]) : exportAuthoringModel([imported], 'card')

      await importModule(source)

      expect(updateDoc).toHaveBeenCalledTimes(1)
      expect(updateDoc).toHaveBeenCalledWith(
        card.class.MasterTag,
        core.space.Model,
        document._id,
        expect.objectContaining({ removed: false, label: document.label })
      )
      expect(createDoc).not.toHaveBeenCalled()
      expect(commit).toHaveBeenCalledWith(true)
      expect(existing.removed).toBe(true)
    })

    it('does not update an unchanged active type', async () => {
      const { createDoc, updateDoc } = setup([document])
      const source = format === 'json' ? JSON.stringify([document]) : exportAuthoringModel([document], 'card')

      await importModule(source)

      expect(updateDoc).not.toHaveBeenCalled()
      expect(createDoc).not.toHaveBeenCalled()
    })
  })

  it('reports a rejected import commit', async () => {
    const { commit } = setup()
    commit.mockResolvedValue({ result: false })
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(importModule(source)).rejects.toThrow('Importing the card module failed')
    } finally {
      log.mockRestore()
    }
  })

  it('creates fields and a native process attached to the generated card type', async () => {
    const { createDoc, commit } = setup()
    await importModule(source)
    const calls = createDoc.mock.calls
    const master = calls.find((call) => call[0] === 'card:class:MasterTag')
    const attributes = calls.filter((call) => call[0] === 'core:class:Attribute')
    const process = calls.find((call) => call[0] === 'process:class:Process')
    expect(attributes).toHaveLength(4)
    expect(attributes.every((call) => call[2].attributeOf === master?.[3])).toBe(true)
    expect(process?.[2]).toEqual(expect.objectContaining({ masterTag: master?.[3], autoStart: true }))
    expect(JSON.stringify(calls)).not.toContain('__SLOT_')
    expect(commit).toHaveBeenCalledWith(true)
  })

  it('rejects an invalid definition before writing model documents', async () => {
    const { createDoc, commit } = setup()
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(importModule(source.replace('to: calculate_score', 'to: missing'))).rejects.toThrow(
        'Expected a state belonging to this process'
      )
      expect(createDoc).not.toHaveBeenCalled()
      expect(commit).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
})
