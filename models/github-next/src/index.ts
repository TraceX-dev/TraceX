//
// Copyright © 2026 Hardcore Engineering Inc.
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

import core, { IndexKind, type Class, type Doc, type Domain, type Ref } from '@hcengineering/core'
import contact from '@hcengineering/contact'
import githubNext, {
  githubNextIntegrationKind,
  type GithubNextObjectSyncState,
  type GithubNextRepository
} from '@hcengineering/github-next'
import integration, {
  type IntegrationAttributeSlotModel,
  type IntegrationSlotProvider
} from '@hcengineering/integration'
import {
  type Builder,
  Collection,
  Index,
  Model,
  Prop,
  TypeBoolean,
  TypeCollaborativeDoc,
  TypeMarkup,
  TypeNumber,
  TypePersonId,
  TypeRecord,
  TypeRef,
  TypeString,
  TypeTimestamp,
  UX
} from '@hcengineering/model'
import { TDoc } from '@hcengineering/model-core'
import { getEmbeddedLabel } from '@hcengineering/platform'
import setting from '@hcengineering/setting'
import tags from '@hcengineering/tags'
import githubNextResources from './plugin'

export { githubNextId } from '@hcengineering/github-next'
export { default } from './plugin'

export const DOMAIN_GITHUB_NEXT = 'github_next' as Domain
export const DOMAIN_GITHUB_NEXT_SYNC = 'github_next_sync' as Domain

const githubNextModel = githubNextResources

@Model(githubNext.class.GithubNextRepository, core.class.Doc, DOMAIN_GITHUB_NEXT)
@UX(getEmbeddedLabel('GitHub Next repository'))
export class TGithubNextRepository extends TDoc implements GithubNextRepository {
  @Prop(TypeRef(setting.class.Integration), setting.string.Integrations)
  @Index(IndexKind.Indexed)
    integration!: Ref<Doc>

  @Prop(TypeString(), getEmbeddedLabel('Owner'))
  @Index(IndexKind.Indexed)
    owner!: string

  @Prop(TypeString(), getEmbeddedLabel('Repository'))
  @Index(IndexKind.Indexed)
    name!: string

  @Prop(TypeNumber(), getEmbeddedLabel('Repository ID'))
    repositoryId?: number

  @Prop(TypeString(), getEmbeddedLabel('Node ID'))
    nodeId?: string

  @Prop(TypeString(), getEmbeddedLabel('HTML URL'))
    htmlUrl?: string

  @Prop(TypeString(), getEmbeddedLabel('Default branch'))
    defaultBranch?: string

  @Prop(TypeBoolean(), getEmbeddedLabel('Enabled'))
    enabled!: boolean
}

@Model(githubNext.class.GithubNextObjectSyncState, core.class.Doc, DOMAIN_GITHUB_NEXT_SYNC)
@UX(getEmbeddedLabel('GitHub Next sync state'))
export class TGithubNextObjectSyncState extends TDoc implements GithubNextObjectSyncState {
  @Prop(TypeRef(setting.class.Integration), setting.string.Integrations)
  @Index(IndexKind.Indexed)
    integration!: Ref<Doc>

  @Prop(TypeRef(integration.class.IntegrationSlotProvider), getEmbeddedLabel('Provider'))
  @Index(IndexKind.Indexed)
    provider!: Ref<IntegrationSlotProvider>

  @Prop(TypeRef(githubNext.class.GithubNextRepository), getEmbeddedLabel('Repository'))
  @Index(IndexKind.Indexed)
    repository!: Ref<GithubNextRepository>

  @Prop(TypeString(), getEmbeddedLabel('External ID'))
  @Index(IndexKind.Indexed)
    externalId!: string

  @Prop(TypeNumber(), getEmbeddedLabel('External number'))
    externalNumber?: number

  @Prop(TypeString(), getEmbeddedLabel('External URL'))
    externalUrl?: string

  @Prop(TypeString(), getEmbeddedLabel('External node ID'))
    externalNodeId?: string

  @Prop(TypeRef(core.class.Class), getEmbeddedLabel('Target class'))
  @Index(IndexKind.Indexed)
    targetClass!: Ref<Class<Doc>>

  @Prop(TypeRef(core.class.Doc), getEmbeddedLabel('Target'))
  @Index(IndexKind.Indexed)
    targetId!: Ref<Doc>

  @Prop(TypeString(), getEmbeddedLabel('External version'))
    externalVersion?: string

  @Prop(TypeTimestamp(), getEmbeddedLabel('External updated at'))
    externalUpdatedAt?: number

  @Prop(TypeString(), getEmbeddedLabel('External hash'))
    externalHash!: string

  @Prop(TypeString(), getEmbeddedLabel('Target hash'))
    targetHash!: string

  @Prop(TypeRecord(), getEmbeddedLabel('External values'))
    externalValues?: Record<string, unknown>

  @Prop(TypeRecord(), getEmbeddedLabel('Target values'))
    targetValues?: Record<string, unknown>

  @Prop(TypeString(), getEmbeddedLabel('Last direction'))
    lastDirection!: 'inbound' | 'outbound'

  @Prop(TypeTimestamp(), getEmbeddedLabel('Last synced on'))
    lastSyncedOn!: number

  @Prop(TypePersonId(), getEmbeddedLabel('Last actor'))
    lastActor?: GithubNextObjectSyncState['lastActor']

  error?: Record<string, any>

  @Prop(TypeTimestamp(), getEmbeddedLabel('Retry after'))
    retryAfter?: number
}

export function createModel (builder: Builder): void {
  builder.createModel(TGithubNextRepository, TGithubNextObjectSyncState)

  builder.createDoc(
    setting.class.IntegrationType,
    core.space.Model,
    {
      label: getEmbeddedLabel('GitHub Next'),
      description: getEmbeddedLabel('GitHub OAuth integration for generic slot-based sync.'),
      icon: githubNextModel.component.GithubNextIcon,
      allowMultiple: false,
      createComponent: githubNextModel.component.Connect,
      configureComponent: githubNextModel.component.Configure,
      onDisconnect: githubNextModel.handler.DisconnectHandler,
      kind: githubNextIntegrationKind
    },
    githubNext.integrationType.GithubNext
  )

  const titleSlot: IntegrationAttributeSlotModel = {
    slotKind: 'attribute',
    _class: core.class.Attribute,
    label: getEmbeddedLabel('Title'),
    type: TypeString()
  }
  const descriptionSlot: IntegrationAttributeSlotModel = {
    slotKind: 'attribute',
    _class: core.class.Attribute,
    label: getEmbeddedLabel('Description'),
    type: TypeMarkup(),
    types: [TypeMarkup(), TypeCollaborativeDoc()]
  }
  const stateSlot: IntegrationAttributeSlotModel = {
    slotKind: 'attribute',
    _class: core.class.Attribute,
    label: getEmbeddedLabel('State'),
    type: TypeString(),
    values: [
      { value: 'open', label: getEmbeddedLabel('Open') },
      { value: 'closed', label: getEmbeddedLabel('Closed') }
    ]
  }
  const externalUrlSlot: IntegrationAttributeSlotModel = {
    slotKind: 'attribute',
    _class: core.class.Attribute,
    label: getEmbeddedLabel('External URL'),
    type: TypeString()
  }
  const numberSlot: IntegrationAttributeSlotModel = {
    slotKind: 'attribute',
    _class: core.class.Attribute,
    label: getEmbeddedLabel('Number'),
    type: TypeNumber()
  }
  const assigneeSlot: IntegrationAttributeSlotModel = {
    slotKind: 'attribute',
    _class: core.class.Attribute,
    label: getEmbeddedLabel('Assignee'),
    type: TypeRef(contact.class.Person)
  }
  const labelsSlot: IntegrationAttributeSlotModel = {
    slotKind: 'attribute',
    _class: core.class.Attribute,
    label: getEmbeddedLabel('Labels'),
    type: Collection(tags.class.TagReference)
  }
  const categorySlot: IntegrationAttributeSlotModel = {
    slotKind: 'attribute',
    _class: core.class.Attribute,
    label: getEmbeddedLabel('Category'),
    type: TypeString()
  }

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_GITHUB_NEXT_SYNC,
    indexes: [
      { keys: { integration: 1, provider: 1, repository: 1, externalId: 1 } },
      { keys: { integration: 1, targetClass: 1, targetId: 1 } }
    ]
  })

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_GITHUB_NEXT,
    indexes: [{ keys: { integration: 1, owner: 1, name: 1 } }]
  })

  builder.createDoc(
    integration.class.IntegrationSlotProvider,
    core.space.Model,
    {
      integrationType: githubNext.integrationType.GithubNext,
      label: getEmbeddedLabel('GitHub issue'),
      requiredSlots: {
        title: titleSlot
      },
      optionalSlots: {
        description: descriptionSlot,
        state: stateSlot,
        externalUrl: externalUrlSlot,
        number: numberSlot,
        assignee: assigneeSlot,
        labels: labelsSlot
      }
    },
    githubNext.ids.GithubNextIssueProvider
  )

  builder.createDoc(
    integration.class.IntegrationSlotProvider,
    core.space.Model,
    {
      integrationType: githubNext.integrationType.GithubNext,
      label: getEmbeddedLabel('GitHub discussion'),
      requiredSlots: {
        title: titleSlot
      },
      optionalSlots: {
        description: descriptionSlot,
        category: categorySlot,
        state: stateSlot,
        externalUrl: externalUrlSlot,
        number: numberSlot
      }
    },
    githubNext.ids.GithubNextDiscussionProvider
  )
}
