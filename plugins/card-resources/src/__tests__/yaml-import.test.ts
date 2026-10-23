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

import { getClient } from '@hcengineering/presentation'
import process from '@hcengineering/process'
import { importModule } from '../exporter'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const source = readFileSync(`${__dirname}/../../../process/docs/examples/risk-management.card.yaml`, 'utf8')

function setup (): { createDoc: jest.Mock, commit: jest.Mock } {
  const createDoc = jest.fn().mockResolvedValue(undefined)
  const commit = jest.fn().mockResolvedValue({ result: true })
  const registry = [
    ...Object.values(process.method).map((_id) => ({ _id, _class: process.class.Method })),
    ...Object.values(process.trigger).map((_id) => ({ _id, _class: process.class.Trigger })),
    ...Object.values(process.function).map((_id) => ({ _id, _class: process.class.ProcessFunction }))
  ]
  ;(getClient as jest.Mock).mockReturnValue({
    getHierarchy: () => ({ isDerived: () => false }),
    getModel: () => ({ findObject: (id: string) => registry.find((doc) => doc._id === id) }),
    apply: () => ({ createDoc, commit })
  })
  return { createDoc, commit }
}

describe('YAML card module import', () => {
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
