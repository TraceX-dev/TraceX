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

import { generateId, type AccountUuid } from '@hcengineering/core'
import {
  compareDefinitionPackageVersions,
  createDefinitionPackageRelease,
  serializeDefinitionPackageRelease,
  DefinitionPackageError
} from './definition-package'
import type { DefinitionPackageInfo } from './types'

/** Assigns package identity and release numbers automatically; only description is authored in the dialog. */
export function createDefinitionPackageMetadata (
  author: AccountUuid,
  description: string,
  previous?: DefinitionPackageInfo
): DefinitionPackageInfo {
  if (previous !== undefined && previous.author !== author) {
    throw new DefinitionPackageError('package.author', 'Only the package author can create a new version')
  }
  let version = '1.0.0'
  if (previous !== undefined) {
    const [major, minor, patch] = previous.version.split('-')[0].split('+')[0].split('.')
    version = `${major}.${minor}.${BigInt(patch) + 1n}`
  }
  return {
    id: previous?.id ?? `local/package-${generateId()}`,
    version,
    author,
    description: description.trim(),
    ...(previous?.members !== undefined ? { members: [...previous.members] } : {})
  }
}

/** Creates a portable release file, retaining the previous package identity for a new version. */
export async function createDefinitionPackageExport (
  source: string,
  manifest: DefinitionPackageInfo,
  previous?: DefinitionPackageInfo
): Promise<string> {
  const { members, ...metadata } = manifest
  const release = await createDefinitionPackageRelease({ package: metadata, source })
  if (previous !== undefined) {
    if (release.package.id !== previous.id) {
      throw new DefinitionPackageError('package.id', 'A new package version must retain the previous package identity')
    }
    if (manifest.author !== previous.author) {
      throw new DefinitionPackageError('package.author', 'Only the package author can create a new version')
    }
    if (compareDefinitionPackageVersions(release.package.version, previous.version) <= 0) {
      throw new DefinitionPackageError('package.version', 'The new version must be greater than the previous version')
    }
  }
  return serializeDefinitionPackageRelease(release)
}
