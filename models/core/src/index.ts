//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
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

import {
  AccountRole,
  DOMAIN_BENCHMARK,
  DOMAIN_BLOB,
  DOMAIN_CONFIGURATION,
  DOMAIN_MIGRATION,
  DOMAIN_SPACE,
  DOMAIN_STATUS,
  DOMAIN_TRANSIENT,
  DOMAIN_TX,
  GuestActivityScope,
  GuestSecurityProfile,
  ownBy,
  relatedVia,
  viaClassField
} from '@hcengineering/core'
import { type Builder } from '@hcengineering/model'
import { TBenchmarkDoc } from './benchmark'
import core from './component'
import {
  TArrOf,
  TAssociation,
  TAttachedDoc,
  TAttribute,
  TBlob,
  TClass,
  TClassCollaborators,
  TCollaborator,
  TCollection,
  TConfiguration,
  TConfigurationElement,
  TCustomSequence,
  TDoc,
  TDomainIndexConfiguration,
  TEnum,
  TEnumOf,
  TFullTextSearchContext,
  TIndexConfiguration,
  TInterface,
  TMigrationState,
  TMixin,
  TObj,
  TPluginConfiguration,
  TRefTo,
  TRelation,
  TRelationMetadata,
  TSequence,
  TTransientConfiguration,
  TTTransientTTL,
  TType,
  TTypeAccountUuid,
  TTypeAny,
  TTypeBlob,
  TTypeBoolean,
  TTypeCollaborativeDoc,
  TTypeDate,
  TTypeFileSize,
  TTypeHyperlink,
  TTypeIdentifier,
  TTypeIntlString,
  TTypeMarkup,
  TTypeNumber,
  TTypePersonId,
  TTypeRank,
  TTypeRecord,
  TTypeRelatedDocument,
  TTypeString,
  TTypeTimestamp,
  TVersion,
  TVersionableClass
} from './core'
import { definePermissions } from './permissions'
import {
  TAttributePermission,
  TGuestActivitySettings,
  TModulePermissionGroup,
  TClassPermission,
  TPermission,
  TRole,
  TSpace,
  TSpaceType,
  TSpaceTypeDescriptor,
  TSystemSpace,
  TTypedSpace
} from './security'
import { defineSpaceType } from './spaceType'
import { TDomainStatusPlaceholder, TStatus, TStatusCategory } from './status'
import { TUserStatus } from './transient'
import { TTx, TTxApplyIf, TTxCreateDoc, TTxCUD, TTxMixin, TTxRemoveDoc, TTxUpdateDoc, TTxWorkspaceEvent } from './tx'

export { coreId, DOMAIN_SPACE } from '@hcengineering/core'
export * from './core'
export {
  coreOperation,
  getAccountsFromTxes,
  getAccountUuidByOldAccount,
  getAccountUuidBySocialKey,
  getSocialIdBySocialKey,
  getSocialIdFromOldAccount,
  getSocialKeyByOldAccount,
  getSocialKeyByOldEmail,
  getUniqueAccounts,
  getUniqueAccountsFromOldAccounts
} from './migration'
export * from './security'
export * from './status'
export * from './tx'
export { core as default }

export function createModel (builder: Builder): void {
  builder.createModel(
    TObj,
    TDoc,
    TClass,
    TMixin,
    TInterface,
    TTx,
    TTxCUD,
    TTxCreateDoc,
    TAttachedDoc,
    TTxMixin,
    TTxUpdateDoc,
    TTxRemoveDoc,
    TTxApplyIf,
    TTxWorkspaceEvent,
    TSpace,
    TSystemSpace,
    TTypedSpace,
    TSpaceType,
    TSpaceTypeDescriptor,
    TRole,
    TPermission,
    TModulePermissionGroup,
    TAttributePermission,
    TClassPermission,
    TGuestActivitySettings,
    TAttribute,
    TType,
    TEnumOf,
    TTypeMarkup,
    TTypePersonId,
    TTypeAccountUuid,
    TTypeCollaborativeDoc,
    TArrOf,
    TRefTo,
    TTypeDate,
    TTypeFileSize,
    TTypeTimestamp,
    TTypeNumber,
    TTypeIdentifier,
    TTypeBoolean,
    TTypeString,
    TTypeRank,
    TTypeRecord,
    TTypeBlob,
    TTypeHyperlink,
    TCollection,
    TVersion,
    TTypeIntlString,
    TPluginConfiguration,
    TUserStatus,
    TEnum,
    TTypeAny,
    TTypeRelatedDocument,
    TFullTextSearchContext,
    TConfiguration,
    TConfigurationElement,
    TIndexConfiguration,
    TStatus,
    TSequence,
    TCustomSequence,
    TDomainStatusPlaceholder,
    TStatusCategory,
    TMigrationState,
    TBlob,
    TRelation,
    TRelationMetadata,
    TAssociation,
    TDomainIndexConfiguration,
    TBenchmarkDoc,
    TTransientConfiguration,
    TClassCollaborators,
    TCollaborator,
    TVersionableClass,
    TTTransientTTL
  )

  builder.mixin(core.class.Collaborator, core.class.Class, core.mixin.RowVisibility, {
    policy: ownBy('collaborator', 'accountUuid'),
    // Reading a collaborator row means "am I the collaborator". Changing one means "did I create
    // the document it hangs off" - a different question, so a separate write policy. The parent
    // can be of any class, so the step takes its class from the row's own `attachedToClass`.
    // Whether a role may touch collaborators at all stays a Layer 1 permission
    // (card.ids.GuestCollaboratorClassPermission).
    writePolicy: relatedVia(
      {
        from: 'socialId',
        steps: [{ via: viaClassField('attachedToClass'), match: 'createdBy', emit: '_id' }],
        to: 'attachedTo'
      },
      'Collaborators are managed by the creator of the document they attach to'
    ),
    allowKnownIdBypass: true,
    knownIdBypassReason: 'Collaborator records are resolved from an already visible parent document',
    knownIdBypassFields: ['attachedTo']
  })

  builder.createDoc(
    core.class.GuestActivitySettings,
    core.space.Model,
    {
      role: AccountRole.Guest,
      securityProfile: GuestSecurityProfile.Participant,
      activityScope: GuestActivityScope.Own
    },
    core.ids.GuestActivitySettingsGuest
  )

  builder.createDoc(
    core.class.GuestActivitySettings,
    core.space.Model,
    {
      role: AccountRole.DocGuest,
      securityProfile: GuestSecurityProfile.Viewer,
      activityScope: GuestActivityScope.Own
    },
    core.ids.GuestActivitySettingsDocGuest
  )

  builder.createDoc(
    core.class.GuestActivitySettings,
    core.space.Model,
    {
      role: AccountRole.ReadOnlyGuest,
      securityProfile: GuestSecurityProfile.Viewer,
      activityScope: GuestActivityScope.Own
    },
    core.ids.GuestActivitySettingsReadOnlyGuest
  )

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_TX,
    disabled: [
      { _class: 1 },
      { space: 1 },
      { objectClass: 1 },
      { createdBy: 1 },
      { createdBy: -1 },
      { createdOn: -1 },
      { modifiedBy: 1 }
    ],
    indexes: [
      {
        keys: {
          objectSpace: 1
        }
      }
    ]
  })

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_TRANSIENT,
    disableCollection: true,
    disabled: [
      { _id: 1 },
      { space: 1 },
      { objectClass: 1 },
      { modifiedBy: 1 },
      { createdBy: 1 },
      { createdBy: -1 },
      { createdOn: -1 }
    ]
  })

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_BENCHMARK,
    disableCollection: true,
    disabled: []
  })

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_CONFIGURATION,
    disabled: [
      { _class: 1 },
      { space: 1 },
      { modifiedOn: 1 },
      { modifiedBy: 1 },
      { createdBy: 1 },
      { createdBy: -1 },
      { createdOn: -1 }
    ]
  })

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_MIGRATION,
    disabled: [
      { _class: 1 },
      { space: 1 },
      { modifiedOn: 1 },
      { modifiedBy: 1 },
      { createdBy: 1 },
      { createdBy: -1 },
      { createdOn: -1 }
    ]
  })

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_STATUS,
    disabled: [
      { modifiedOn: 1 },
      { modifiedBy: 1 },
      { createdBy: 1 },
      { createdBy: -1 },
      { createdOn: -1 },
      { space: 1 }
    ]
  })
  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_SPACE,
    disabled: [{ space: 1 }, { modifiedBy: 1 }, { createdBy: 1 }, { createdBy: -1 }, { createdOn: -1 }]
  })

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_BLOB,
    disabled: [
      { _class: 1 },
      { space: 1 },
      { modifiedBy: 1 },
      { createdBy: 1 },
      { createdBy: -1 },
      { createdOn: -1 },
      { modifiedOn: 1 }
    ]
  })

  builder.createDoc(core.class.FullTextSearchContext, core.space.Model, {
    toClass: core.class.Space
  })

  definePermissions(builder)
  defineSpaceType(builder)

  builder.createDoc(core.class.FullTextSearchContext, core.space.Model, {
    toClass: core.class.MigrationState,
    forceIndex: false
  })
  builder.mixin(core.class.Configuration, core.class.Class, core.mixin.IndexConfiguration, {
    indexes: [],
    searchDisabled: true
  })
  builder.mixin(core.class.MigrationState, core.class.Class, core.mixin.IndexConfiguration, {
    indexes: [],
    searchDisabled: true
  })
}
