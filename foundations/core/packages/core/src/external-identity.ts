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

import { SocialIdType, type SocialId, type PersonUuid } from './classes'

/** Canonical source names are fixed when access is granted, never read from request headers. */
export function normalizeExternalSource (source: string): string {
  const normalized = source.trim().toLowerCase().replace(/\s+/g, '-')
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)) {
    throw new Error('External source must contain 1-64 letters, digits, dots, underscores or hyphens')
  }
  return normalized
}

/** Stable across workspaces, token rotation and independent connections to the same source. */
export function externalIdentityValue (account: PersonUuid, source: string): string {
  return `${account}:${normalizeExternalSource(source)}`
}

/** Reads historical identities too, including the suffix added when a social ID is soft-deleted. */
export function getExternalSource (identity: Pick<SocialId, 'type' | 'value'>): string | undefined {
  if (identity.type !== SocialIdType.EXTERNAL) return undefined
  return identity.value.slice(identity.value.indexOf(':') + 1).split('#')[0]
}
