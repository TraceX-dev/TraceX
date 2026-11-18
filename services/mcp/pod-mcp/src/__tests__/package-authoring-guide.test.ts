// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { compileProcessYaml } from '@hcengineering/process'
import { readPackageAuthoringGuide } from '../package-authoring-guide'

let mockBundledDirectory: string | undefined

jest.mock('node:fs/promises', () => {
  const actual: typeof import('node:fs/promises') = jest.requireActual('node:fs/promises')
  return {
    ...actual,
    readFile: jest.fn(async (...args: Parameters<typeof actual.readFile>) => {
      if (mockBundledDirectory !== undefined) {
        const suffix = String(args[0]).split(`${sep}authoring${sep}`)[1]
        if (suffix === undefined) throw new Error('Repository reads are unavailable in the MCP container')
        args[0] = resolve(mockBundledDirectory, suffix)
      }
      return await actual.readFile(...args)
    })
  }
})

describe('shipped MCP authoring documentation without repository access', () => {
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'tracex-authoring-guide-'))
    const canonical = resolve(__dirname, '../../../../../plugins/process/docs')
    for (const file of ['authoring.md', 'authoring-v2.schema.json', 'examples']) {
      await cp(resolve(canonical, file), resolve(directory, file), { recursive: true })
    }
    mockBundledDirectory = directory
  })

  afterAll(async () => {
    mockBundledDirectory = undefined
    await rm(directory, { recursive: true, force: true })
  })

  it('serves the preferences, actual presence semantics, schema and complete three-process example from shipped assets', async () => {
    const start = await readPackageAuthoringGuide()
    expect(start.sections).toEqual(
      expect.arrayContaining([
        'Manager-facing authoring',
        'Design preferences',
        'Value is set',
        'Worked risk management example'
      ])
    )
    expect(start.examples).toEqual(expect.arrayContaining(['example:risk-management-reactive.card.yaml']))
    expect(String(start.content).length).toBeLessThan(2500)
    expect(start.content).not.toEqual(expect.stringContaining('global author account UUID'))
    const manager = await readPackageAuthoringGuide('Manager-facing authoring')
    expect(manager.content).toEqual(expect.stringContaining('agent owns the technical design'))
    expect(manager.content).toEqual(expect.stringContaining('record it as an assumption'))
    expect(manager).not.toHaveProperty('sections')
    expect(manager).not.toHaveProperty('instructions')
    const lifecycle = await readPackageAuthoringGuide('Package format and UI lifecycle')
    expect(lifecycle.content).toEqual(expect.stringContaining('global author account UUID'))
    const preferences = await readPackageAuthoringGuide('Design preferences')
    expect(preferences.content).toEqual(expect.stringContaining('specific business need'))
    const presence = await readPackageAuthoringGuide('Value is set')
    expect(presence.content).toEqual(expect.stringContaining('| `null` | true |'))
    expect(presence.content).toEqual(expect.stringContaining('not proof of validity'))
    const risk = await readPackageAuthoringGuide('Worked risk management example')
    expect(risk.content).toEqual(expect.stringContaining('1/5'))
    expect(risk.content).toEqual(expect.stringContaining('not `RunSubProcess`'))
    const example = await readPackageAuthoringGuide('example:risk-management-reactive.card.yaml')
    if (typeof example.content !== 'string') throw new Error('Expected a complete YAML example')
    const compiled = compileProcessYaml(example.content)
    expect(compiled.docs.filter((doc) => doc._class === 'process:class:Process')).toHaveLength(3)
    expect(await readPackageAuthoringGuide('schema')).toMatchObject({ content: expect.stringContaining('"$schema"') })
    await expect(readPackageAuthoringGuide('example:../../outside.yaml')).rejects.toThrow('Unknown guide section')
  })
})
