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

/** The most specific model part shared by two versions. @public */
export type ModelHashMatch = 'none' | 'system' | 'user'

/**
 * Compare system-only hashes or complete `system:current` versions.
 * Empty hashes are unknown versions; `user` means both parts match.
 * @public
 */
export function compareModelHashes (first: string, second: string): ModelHashMatch {
  if (first === '' || second === '') return 'none'
  const firstSeparator = first.indexOf(':')
  const secondSeparator = second.indexOf(':')
  const firstSystem = firstSeparator === -1 ? first : first.slice(0, firstSeparator)
  const secondSystem = secondSeparator === -1 ? second : second.slice(0, secondSeparator)
  if (firstSystem !== secondSystem) return 'none'
  if (firstSeparator !== -1 && secondSeparator !== -1 &&
    first.slice(firstSeparator + 1) === second.slice(secondSeparator + 1)) {
    return 'user'
  }
  return 'system'
}
