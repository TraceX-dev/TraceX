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

import type { AccountUuid, Doc, Ref } from '@hcengineering/core'
import { compileProcessYaml } from '@hcengineering/process'
import { parseDefinitionPackageRelease } from '../definition-package'
import { createDefinitionPackageExport, createDefinitionPackageMetadata } from '../definition-package-export'
import type { DefinitionPackageInfo } from '../types'

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const newDefinitionYaml = (kind: 'card' | 'process'): string =>
  readFileSync(
    `${__dirname}/../../../process/docs/examples/${kind === 'card' ? 'risk-management.card.yaml' : 'review-task.process.yaml'}`,
    'utf8'
  )

describe('package exports', () => {
  const manifest: DefinitionPackageInfo = {
    id: 'acme/review',
    version: '1.0.0',
    author: 'author-account' as AccountUuid
  }

  it('creates package identities automatically and stores the authored description', async () => {
    const first = createDefinitionPackageMetadata(manifest.author, '  Review package  ')
    const second = createDefinitionPackageMetadata(manifest.author, '')
    expect(first).toMatchObject({ version: '1.0.0', author: manifest.author, description: 'Review package' })
    expect(first.id).not.toBe(second.id)
    const release = await parseDefinitionPackageRelease(
      await createDefinitionPackageExport(newDefinitionYaml('card'), first)
    )
    expect(release.package).toEqual(first)
  })

  it('advances the stored version automatically and allows changing or clearing the description', () => {
    const previous = { ...manifest, description: 'Old description' }
    const next = createDefinitionPackageMetadata(manifest.author, 'Updated description', previous)
    expect(next).toEqual({ ...manifest, version: '1.0.1', description: 'Updated description' })
    expect(createDefinitionPackageMetadata(manifest.author, '', next)).toEqual({
      ...manifest,
      version: '1.0.2',
      description: ''
    })
    expect(() => createDefinitionPackageMetadata('other-account' as AccountUuid, '', next)).toThrow(
      'Only the package author'
    )
  })

  it('downloads plain package YAML with metadata beside the card definition', async () => {
    const source = newDefinitionYaml('card')
    const content = await createDefinitionPackageExport(source, manifest)
    expect(content).toContain('cardTypes:')
    expect(content).toContain('package:')
    expect(content).not.toMatch(/^source:/m)
    const release = await parseDefinitionPackageRelease(content)
    expect(release.package).toEqual(manifest)
    expect(release.definition).toEqual(compileProcessYaml(source))
    expect(release.definition.kind).toBe('card')
  })

  it('retains the saved process set across versions and omits workspace membership from the release manifest', async () => {
    const previous = { ...manifest, members: ['first', 'second'] as Ref<Doc>[] }
    const next = createDefinitionPackageMetadata(manifest.author, 'Process bundle', previous)
    expect(next.members).toEqual(previous.members)
    expect(next.members).not.toBe(previous.members)
    const exported = await createDefinitionPackageExport(newDefinitionYaml('process'), next, previous)
    expect(exported).not.toContain('members:')
    expect((await parseDefinitionPackageRelease(exported)).package).toEqual({
      ...manifest,
      version: '1.0.1',
      description: 'Process bundle'
    })
  })

  it('creates a higher version from the current process without changing the previous release', async () => {
    const source = newDefinitionYaml('process')
    const previous = { ...manifest }
    const updated = source.replace('Review card', 'Updated review card')
    const content = await createDefinitionPackageExport(updated, { ...manifest, version: '1.0.1' }, previous)
    const release = await parseDefinitionPackageRelease(content)
    expect(release.package).toEqual({ ...manifest, version: '1.0.1' })
    expect(release.definition).toEqual(compileProcessYaml(updated))
    expect(previous).toEqual(manifest)
  })

  it.each(['1.0.0', '0.9.0', '1.0.0+repacked'])('rejects a non-increasing version %s', async (version) => {
    const source = newDefinitionYaml('process')
    const previous = { ...manifest }
    await expect(createDefinitionPackageExport(source, { ...manifest, version }, previous)).rejects.toThrow('greater')
  })

  it('rejects changing the package identity in a new version', async () => {
    const source = newDefinitionYaml('process')
    const previous = { ...manifest }
    await expect(
      createDefinitionPackageExport(source, { ...manifest, id: 'other/review', version: '1.0.1' }, previous)
    ).rejects.toThrow('identity')
  })

  it('rejects a new version from another account even when the dialog is invoked directly', async () => {
    await expect(
      createDefinitionPackageExport(
        newDefinitionYaml('process'),
        {
          ...manifest,
          version: '1.0.1',
          author: 'other-account' as AccountUuid
        },
        manifest
      )
    ).rejects.toThrow('Only the package author')
  })
})
