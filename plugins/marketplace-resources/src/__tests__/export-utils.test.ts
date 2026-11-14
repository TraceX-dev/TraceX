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

import type { MasterTag } from '@hcengineering/card'
import type { AccountUuid } from '@hcengineering/core'
import type { DefinitionPackageInfo } from '@hcengineering/marketplace'
import type { Process } from '@hcengineering/process'
import { getDefinitionPackageExportItems, getDefinitionPackageOwner } from '../export-utils'

describe('package export context', () => {
  const manifest: DefinitionPackageInfo = {
    id: 'acme/review',
    version: '1.0.0',
    author: 'author-account' as AccountUuid
  }

  it('offers creation for unpackaged definitions and new versions only to the recorded author', () => {
    expect(getDefinitionPackageExportItems(undefined, manifest.author).map((item) => item.id)).toEqual(['make-package'])
    expect(getDefinitionPackageExportItems(manifest, manifest.author).map((item) => item.id)).toEqual([
      'new-package-version'
    ])
    expect(getDefinitionPackageExportItems(manifest, 'other-account' as AccountUuid)).toEqual([])
  })

  it('resolves a card package from its embedded process while retaining standalone package ownership', () => {
    const masterTag = { _id: 'card-type', definitionPackage: manifest } as unknown as MasterTag
    const definition = { _id: 'process', masterTag: masterTag._id } as unknown as Process
    expect(getDefinitionPackageOwner(definition, masterTag)).toBe(masterTag)
    const standalone = { ...definition, definitionPackage: { ...manifest, id: 'acme/standalone' } }
    expect(getDefinitionPackageOwner(standalone, masterTag)).toBe(standalone)
    const otherType = { ...masterTag, _id: 'other-type' as MasterTag['_id'] }
    expect(getDefinitionPackageOwner(definition, otherType)).toBe(definition)
  })
})
