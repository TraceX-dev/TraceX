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

import {
  createDefinitionPackageRelease,
  parseDefinitionPackageRelease,
  serializeDefinitionPackageRelease
} from '../definition-package'
import { planDefinitionPackageUpgrade } from '../definition-package-plan'
import type { DefinitionPackageUpgradePlan } from '../definition-package-types'

interface CliServices {
  readFile: (path: string) => string
  output: (value: string) => void
  error: (value: string) => void
  engine: {
    createDefinitionPackageRelease: typeof createDefinitionPackageRelease
    serializeDefinitionPackageRelease: typeof serializeDefinitionPackageRelease
    parseDefinitionPackageRelease: typeof parseDefinitionPackageRelease
    planDefinitionPackageUpgrade: typeof planDefinitionPackageUpgrade
  }
}

const { main } = jest.requireActual<{
  main: (args: string[], services: CliServices) => Promise<number>
}>('../../scripts/package-plan')
// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const source = readFileSync(`${__dirname}/../../../process/docs/examples/procurement-workspace.card.yaml`, 'utf8')

function services (files: Record<string, string> = {}): CliServices & { output: jest.Mock, error: jest.Mock } {
  return {
    readFile: (path) => {
      if (files[path] === undefined) throw new Error(`File not found: ${path}`)
      return files[path]
    },
    output: jest.fn(),
    error: jest.fn(),
    engine: {
      createDefinitionPackageRelease,
      serializeDefinitionPackageRelease,
      parseDefinitionPackageRelease,
      planDefinitionPackageUpgrade
    }
  }
}

async function artifact (yaml: string, version: string): Promise<string> {
  const release = await createDefinitionPackageRelease({ package: { id: 'acme/procurement', version }, source: yaml })
  return serializeDefinitionPackageRelease(release)
}

describe('definition package command', () => {
  it('creates a verifiable YAML package using the real shared compiler and release API', async () => {
    const io = services({ 'module.yaml': source })
    expect(await main(['release', 'acme/procurement', '1.0.0', 'module.yaml'], io)).toBe(0)
    const result = await parseDefinitionPackageRelease(String(io.output.mock.calls[0][0]))
    expect(result.definition.docs.filter((doc) => doc._class === 'core:class:Attribute')).toHaveLength(63)
    expect(io.error).not.toHaveBeenCalled()
    const content = String(io.output.mock.calls[0][0])
    expect(content).toContain('cardTypes:')
    expect(content).not.toMatch(/^source:/m)
  })

  it('prints unchanged findings with no automatic apply permission', async () => {
    const io = services({ old: await artifact(source, '1.0.0'), next: await artifact(source, '1.0.1') })
    expect(await main(['compare', 'old', 'next'], io)).toBe(0)
    const result = JSON.parse(String(io.output.mock.calls[0][0])) as DefinitionPackageUpgradePlan
    expect(result.status).toBe('unchanged')
    expect(result.canAutoApply).toBe(false)
    expect(io.error).not.toHaveBeenCalled()
  })

  it('returns review/conflict exit codes and uses the provided local YAML', async () => {
    const incoming = source.replace('label: Procurement project', 'label: Incoming project')
    const local = source.replace('label: Procurement project', 'label: Local project')
    const io = services({ old: await artifact(source, '1.0.0'), next: await artifact(incoming, '1.1.0'), local })
    expect(await main(['compare', 'old', 'next', 'local'], io)).toBe(1)
    const result = JSON.parse(String(io.output.mock.calls[0][0])) as DefinitionPackageUpgradePlan
    expect(result.status).toBe('conflict')
    const major = services({ old: await artifact(source, '1.0.0'), next: await artifact(source, '2.0.0') })
    expect(await main(['compare', 'old', 'next'], major)).toBe(1)
  })

  it('reports missing files, bad artifacts and invalid command usage without emitting a partial result', async () => {
    const missing = services()
    expect(await main(['compare', 'old', 'next'], missing)).toBe(2)
    expect(missing.error).toHaveBeenCalledWith('File not found: old')
    expect(missing.output).not.toHaveBeenCalled()
    const malformed = services({ old: '{}' })
    expect(await main(['compare', 'old', 'next'], malformed)).toBe(2)
    expect(malformed.output).not.toHaveBeenCalled()
    for (const args of [[], ['compare', 'old'], ['release'], ['--unknown']]) {
      const io = services()
      expect(await main(args, io)).toBe(2)
      expect(io.error).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
    }
    const help = services()
    expect(await main(['--help'], help)).toBe(0)
    expect(help.output).toHaveBeenCalledWith(expect.stringContaining('Never imports'))
  })
})
