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

import type { CatalogPackage, CatalogPage, CatalogSearch, MarketplaceClient } from '@hcengineering/marketplace'

/** Skip pages of unrelated packages without losing the catalog's continuation offset. */
export async function listCatalogPackages (
  client: Pick<MarketplaceClient, 'list'>,
  options: CatalogSearch,
  kind: CatalogPackage['kind'] | undefined,
  isCurrent: () => boolean = () => true
): Promise<CatalogPage<CatalogPackage>> {
  let offset = options.offset
  while (true) {
    const page = await client.list({ ...options, offset })
    const items = kind === undefined ? page.items : page.items.filter((entry) => entry.kind === kind)
    if (items.length > 0 || page.nextOffset === undefined || !isCurrent()) {
      return { items, nextOffset: page.nextOffset }
    }
    offset = page.nextOffset
  }
}
