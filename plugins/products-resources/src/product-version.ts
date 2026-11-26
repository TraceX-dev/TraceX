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

import { type ProductVersion } from '@hcengineering/products'

export type ProductVersionSeverity = 'major' | 'minor' | 'patch'

export type ProductVersionNumber = Pick<ProductVersion, 'major' | 'minor' | 'patch'>

/**
 * Calculates the next product version number from the parent version (semver rules).
 * Without a parent the first version is 1.0.0.
 */
export function getNextProductVersionNumber (
  parent: ProductVersionNumber | null | undefined,
  severity: ProductVersionSeverity
): ProductVersionNumber {
  if (parent == null) {
    return { major: 1, minor: 0, patch: 0 }
  }

  switch (severity) {
    case 'major':
      return { major: parent.major + 1, minor: 0, patch: 0 }
    case 'minor':
      return { major: parent.major, minor: parent.minor + 1, patch: 0 }
    case 'patch':
      return { major: parent.major, minor: parent.minor, patch: parent.patch + 1 }
  }
}
