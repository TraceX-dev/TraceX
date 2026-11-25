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

import contact, { getCurrentEmployee } from '@hcengineering/contact'
import { getCurrentAccount, type Data, type Ref } from '@hcengineering/core'
import marketplace, {
  compareDefinitionPackageVersions,
  createDefinitionPackageMetadata,
  MarketplaceError,
  parseDefinitionPackageRelease,
  serializeDefinitionPackageRelease,
  updateDefinitionPackageFieldLabels,
  type CatalogPackage,
  type DefinitionPackageDraft,
  type DefinitionPackageRelease
} from '@hcengineering/marketplace'
import { translate } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { getMarketplaceClient, hasMarketplace } from './catalog'

export async function renameDraftFields (
  draft: DefinitionPackageDraft,
  labels: ReadonlyMap<string, string>
): Promise<Ref<DefinitionPackageDraft>> {
  const account = getCurrentAccount().uuid
  const client = getClient()
  const base = await parseDefinitionPackageRelease(draft.release)
  const author = base.package.author
  if (draft.author !== account) throw new Error('Only the draft author can edit it')
  if (hasMarketplace() && author !== undefined) {
    try {
      const entry = await getMarketplaceClient().get({ id: base.package.id, author })
      if (compareDefinitionPackageVersions(entry.version, base.package.version) >= 0) {
        throw new Error(await translate(marketplace.string.ReopenLatestPublication, {}))
      }
    } catch (cause) {
      if (!(cause instanceof MarketplaceError) || cause.status !== 404) throw cause
    }
  }

  const release = serializeDefinitionPackageRelease(await updateDefinitionPackageFieldLabels(base, labels))
  // Share the transaction scope with MCP draft saves so revision checks run under the same lock.
  const apply = client.apply('Save package draft')
  apply.match(marketplace.class.DefinitionPackageDraft, {
    _id: draft._id,
    space: draft.space,
    author: account,
    revision: draft.revision,
    release: draft.release
  })
  await apply.updateDoc(marketplace.class.DefinitionPackageDraft, draft.space, draft._id, {
    release,
    revision: draft.revision + 1
  })
  if (!(await apply.commit()).result) {
    throw new Error(await translate(marketplace.string.ReloadPackageDraft, {}))
  }
  return draft._id
}

export async function createFieldLabelsVersionDraft (
  publication: CatalogPackage,
  base: DefinitionPackageRelease,
  labels: ReadonlyMap<string, string>
): Promise<Ref<DefinitionPackageDraft>> {
  const account = getCurrentAccount().uuid
  const entry = await getMarketplaceClient().get(publication)
  if (
    entry.owner !== account ||
    base.package.id !== entry.id ||
    base.package.author !== entry.author ||
    base.package.version !== entry.version
  ) {
    throw new Error(await translate(marketplace.string.ReopenLatestPublication, {}))
  }

  const client = getClient()
  const space = await client.findOne(contact.class.PersonSpace, { person: getCurrentEmployee() })
  if (space === undefined || !space.private || !space.members.includes(account)) {
    throw new Error(await translate(marketplace.string.PrivateDraftSpaceRequired, {}))
  }

  // The current owner can publish a new release under the original author's package identity.
  const manifest = createDefinitionPackageMetadata(entry.author, base.package.description ?? '', {
    ...base.package,
    author: entry.author
  })
  const updated = await updateDefinitionPackageFieldLabels(base, labels, manifest)
  const data: Data<DefinitionPackageDraft> = {
    author: account,
    name: entry.name,
    review: 'Field labels updated.',
    release: serializeDefinitionPackageRelease(updated),
    revision: 1
  }
  return await client.createDoc(marketplace.class.DefinitionPackageDraft, space._id, data)
}
