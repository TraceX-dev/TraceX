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

import marketplace, {
  MarketplaceClient,
  MarketplaceError,
  compareDefinitionPackageVersions,
  parseDefinitionPackageRelease,
  type CatalogPackageIdentity,
  type DefinitionPackageInstallation
} from '@hcengineering/marketplace'
import { getMetadata } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'

/** Matches workspace installations by publisher and package, independently of the catalog's latest version. */
export function getInstalledPackageVersions (
  identity: CatalogPackageIdentity,
  installations: ReadonlyArray<Pick<DefinitionPackageInstallation, 'package'>>
): string[] {
  return [
    ...new Set(
      installations
        .filter(
          (installation) => installation.package.id === identity.id && installation.package.author === identity.author
        )
        .map((installation) => installation.package.version)
    )
  ].sort((left, right) => compareDefinitionPackageVersions(right, left))
}

export function hasMarketplace (): boolean {
  const url = getMetadata(marketplace.metadata.Url)
  return Boolean(url)
}

export function getMarketplaceClient (): MarketplaceClient {
  const url = getMetadata(marketplace.metadata.Url)
  const token = getMetadata(presentation.metadata.Token)
  if (!url) throw new MarketplaceError(503, 'Marketplace is not configured')
  if (!token) throw new MarketplaceError(401, 'Authentication required')
  return new MarketplaceClient(url, token)
}

/** Verify transport identity as well as integrity before showing an installation or update. */
export async function downloadCatalogRelease (identity: CatalogPackageIdentity, version?: string): Promise<string> {
  const source = await getMarketplaceClient().download(identity, version)
  const release = await parseDefinitionPackageRelease(source)
  if (
    release.package.id !== identity.id ||
    release.package.author !== identity.author ||
    (version !== undefined && release.package.version !== version)
  ) {
    throw new MarketplaceError(502, 'The downloaded release does not match the catalog entry')
  }
  return source
}
