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

import { AccountRole, type Domain } from '@hcengineering/core'
import marketplace, {
  type DefinitionPackageDestination,
  type DefinitionPackageInstallation,
  type DefinitionPackageManifest
} from '@hcengineering/marketplace'
import marketplaceResources from '@hcengineering/marketplace-resources/src/plugin'
import { Model, Prop, TypeRecord, TypeString, type Builder } from '@hcengineering/model'
import core, { TDoc } from '@hcengineering/model-core'
import setting from '@hcengineering/setting'

export { marketplaceId } from '@hcengineering/marketplace'
export { marketplace as default }

const DOMAIN_MARKETPLACE = 'marketplace' as Domain

@Model(marketplace.class.DefinitionPackageInstallation, core.class.Doc, DOMAIN_MARKETPLACE)
export class TDefinitionPackageInstallation extends TDoc implements DefinitionPackageInstallation {
  @Prop(TypeString(), core.string.Name)
    name!: string

  @Prop(TypeRecord(), marketplace.string.InstallPackage)
    package!: DefinitionPackageManifest

  @Prop(TypeString(), marketplace.string.InstallPackage)
    release!: string

  @Prop(TypeRecord(), core.string.Name)
    identities!: Record<string, string>

  @Prop(TypeRecord(), marketplace.string.InstalledPackages)
    destinations!: Record<string, DefinitionPackageDestination>
}

export function createModel (builder: Builder): void {
  builder.createModel(TDefinitionPackageInstallation)
  builder.createDoc(setting.class.SettingsCategory, core.space.Model, {
    name: 'marketplace',
    label: marketplace.string.Marketplace,
    icon: marketplace.icon.Marketplace,
    component: marketplaceResources.component.Marketplace,
    group: 'settings',
    role: AccountRole.Maintainer,
    order: 1000
  })
}
