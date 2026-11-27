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

import { plugin, type Asset, type IntlString, type Metadata, type Plugin } from '@hcengineering/platform'
import type { Class, Ref } from '@hcengineering/core'
import type { DefinitionPackageDraft, DefinitionPackageInstallation } from './types'

export type {
  DefinitionPackageInfo,
  DefinitionPackageOwner,
  DefinitionPackageInstallation,
  DefinitionPackageDraft,
  DefinitionPackageDestination
} from './types'
export { getDefinitionPackageInfo, stripDefinitionPackageInfo } from './types'
export type * from './definition-package-types'
export {
  createDefinitionPackageRelease,
  parseDefinitionPackageRelease,
  isDefinitionPackageSource,
  serializeDefinitionPackageRelease,
  updateDefinitionPackageFieldLabels,
  compareDefinitionPackageVersions,
  parseDefinitionPackageSource,
  withDefinitionPackageDependencies,
  DefinitionPackageError
} from './definition-package'
export { planDefinitionPackageUpgrade } from './definition-package-plan'
export { createDefinitionPackageMetadata, createDefinitionPackageExport } from './definition-package-export'
export {
  prepareDefinitionPackageInstallation,
  getDefinitionPackageProcessSlots
} from './definition-package-installation'
export { prepareDefinitionPackageUpdate } from './definition-package-update'
export {
  resolveDefinitionPackageDependencies,
  prepareDefinitionPackageTreeInstallation,
  withDefinitionPackageModel,
  resolveDefinitionPackageDestinations
} from './definition-package-dependencies'
export type {
  DefinitionPackageResolver,
  ResolvedDefinitionPackage,
  PreparedDefinitionPackageTree,
  PreparedDefinitionPackageRecord
} from './definition-package-dependencies'
export type { PreparedDefinitionPackageUpdate, DefinitionPackageReviewComponents } from './definition-package-update'
export { prepareDefinitionPackageTreeUpdate } from './definition-package-tree-update'
export type { PreparedDefinitionPackageTreeUpdate } from './definition-package-tree-update'
export type * from './catalog-types'
export { MarketplaceClient, MarketplaceError } from './catalog-client'

/** Marketplace owns definition packages, release files and package authoring. */
export const marketplaceId = 'marketplace' as Plugin

export default plugin(marketplaceId, {
  icon: {
    Marketplace: '' as Asset
  },
  metadata: {
    Url: '' as Metadata<string>
  },
  class: {
    DefinitionPackageDraft: '' as Ref<Class<DefinitionPackageDraft>>,
    DefinitionPackageInstallation: '' as Ref<Class<DefinitionPackageInstallation>>
  },
  string: {
    PackageDependencies: '' as IntlString,
    RemovingDependencyLinksKeepsPackagesInstalled: '' as IntlString,
    PackageDrafts: '' as IntlString,
    NoPackageDrafts: '' as IntlString,
    PackageDraftsDescription: '' as IntlString,
    ReviewPackageDraft: '' as IntlString,
    PackageDraftReview: '' as IntlString,
    PackageOverview: '' as IntlString,
    PackageSource: '' as IntlString,
    Origin: '' as IntlString,
    Fields: '' as IntlString,
    EditFieldLabels: '' as IntlString,
    NoEditableFields: '' as IntlString,
    CreateVersionDraft: '' as IntlString,
    ReopenLatestPublication: '' as IntlString,
    ReloadPackageDraft: '' as IntlString,
    PrivateDraftSpaceRequired: '' as IntlString,
    FieldType: '' as IntlString,
    Required: '' as IntlString,
    DefaultValue: '' as IntlString,
    StateGraph: '' as IntlString,
    Transitions: '' as IntlString,
    DeclaredOutputs: '' as IntlString,
    InstallationRequiresMaintainer: '' as IntlString,
    CardModule: '' as IntlString,
    ProcessBundle: '' as IntlString,
    CatalogDescription: '' as IntlString,
    NoInstalledPackages: '' as IntlString,
    NoPublishedPackages: '' as IntlString,
    Catalog: '' as IntlString,
    MyPublications: '' as IntlString,
    PublishPackage: '' as IntlString,
    DeletePackage: '' as IntlString,
    DeletePackageConfirmation: '' as IntlString,
    VersionHistory: '' as IntlString,
    ContactEmailOptional: '' as IntlString,
    ContactEmailVisible: '' as IntlString,
    LoadMore: '' as IntlString,
    UpdateFromCatalog: '' as IntlString,
    MarketplaceNotConfigured: '' as IntlString,
    NoNewVersion: '' as IntlString,
    PublishPackageDescription: '' as IntlString,
    PrivatePackage: '' as IntlString,
    PublicPackage: '' as IntlString,
    PrivatePackageDescription: '' as IntlString,
    MakePrivate: '' as IntlString,
    MakePublic: '' as IntlString,
    ManagePackageAccess: '' as IntlString,
    PackageReaders: '' as IntlString,
    NoPackageReaders: '' as IntlString,
    PackageReadersDescription: '' as IntlString,
    AccountEmail: '' as IntlString,
    GrantReadAccess: '' as IntlString,
    TransferPackageOwnership: '' as IntlString,
    TransferPackageOwnershipDescription: '' as IntlString,
    ConfirmPackageOwnershipTransfer: '' as IntlString,
    MakePackage: '' as IntlString,
    CreateNewPackageVersion: '' as IntlString,
    Export: '' as IntlString,
    Marketplace: '' as IntlString,
    FromMarketplace: '' as IntlString,
    InstallPackage: '' as IntlString,
    InstallAnotherInstance: '' as IntlString,
    InstalledPackages: '' as IntlString,
    Installed: '' as IntlString,
    DisconnectFromPackage: '' as IntlString,
    UpdatePackage: '' as IntlString,
    ReviewPackageChanges: '' as IntlString,
    KeepLocalChanges: '' as IntlString,
    UsePackageVersion: '' as IntlString,
    MigrationRequired: '' as IntlString,
    ProcessChangesAffectActiveExecutions: '' as IntlString,
    CurrentWorkspace: '' as IntlString,
    NewPackageVersion: '' as IntlString,
    WillUpdate: '' as IntlString,
    LocalChangesPreserved: '' as IntlString,
    ChooseVersion: '' as IntlString,
    AlreadyMatches: '' as IntlString,
    NoDefinitionChanges: '' as IntlString,
    PackageUpdateExplanation: '' as IntlString,
    Added: '' as IntlString,
    Removed: '' as IntlString,
    Modified: '' as IntlString,
    NotPresent: '' as IntlString,
    EmptyValue: '' as IntlString,
    Property: '' as IntlString,
    DisplayOrder: '' as IntlString,
    Readonly: '' as IntlString,
    AutomationOnly: '' as IntlString,
    Hidden: '' as IntlString,
    ConflictExplanation: '' as IntlString,
    ShowChanges: '' as IntlString,
    PublishedChanges: '' as IntlString,
    LocalChanges: '' as IntlString,
    UnavailablePackageMember: '' as IntlString,
    UnresolvedPackageDependencies: '' as IntlString
  }
})
