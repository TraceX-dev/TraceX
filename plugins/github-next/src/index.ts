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

import type { Class, Doc, IntegrationKind, PersonId, Ref, Timestamp } from '@hcengineering/core'
import type { IntegrationSlotProvider } from '@hcengineering/integration'
import type { Metadata, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { IntegrationType } from '@hcengineering/setting'

export interface GithubNextCapabilities {
  issues: boolean
  discussions: boolean
  pullRequests: boolean
}

export interface GithubNextRepositorySelection {
  owner: string
  name: string
  repositoryId?: number
  nodeId?: string
  defaultBranch?: string
  htmlUrl?: string
}

export interface GithubNextIssue {
  id: number
  nodeId: string
  number: number
  title: string
  body?: string
  state: 'open' | 'closed'
  htmlUrl: string
  updatedAt: string
  assigneeLogins?: string[]
  assignees?: GithubNextAssignee[]
  labels?: string[]
  repository: GithubNextRepositorySelection
}

export interface GithubNextAssignee {
  login: string
  email?: string
  name?: string
}

export interface GithubNextDiscussionCategory {
  id: string
  name: string
  emoji?: string
}

export interface GithubNextDiscussion {
  id: string
  number: number
  title: string
  body?: string
  state: 'open' | 'closed'
  htmlUrl: string
  updatedAt: string
  category?: GithubNextDiscussionCategory
  repository: GithubNextRepositorySelection
}

export interface GithubNextIntegrationData {
  accountLogin: string
  accountType?: 'User' | 'Organization'
  installationId?: number
  repositories: GithubNextRepositorySelection[]
  capabilities: GithubNextCapabilities
}

export interface GithubNextRepository extends Doc {
  integration: Ref<Doc>
  owner: string
  name: string
  repositoryId?: number
  nodeId?: string
  htmlUrl?: string
  defaultBranch?: string
  enabled: boolean
}

export type GithubNextSyncDirection = 'inbound' | 'outbound'

export interface GithubNextObjectSyncState extends Doc {
  integration: Ref<Doc>
  provider: Ref<IntegrationSlotProvider>
  repository: Ref<GithubNextRepository>
  externalId: string
  externalNumber?: number
  externalUrl?: string
  externalNodeId?: string
  targetClass: Ref<Class<Doc>>
  targetId: Ref<Doc>
  externalVersion?: string
  externalUpdatedAt?: Timestamp
  externalHash: string
  targetHash: string
  externalValues?: Record<string, unknown>
  targetValues?: Record<string, unknown>
  lastDirection: GithubNextSyncDirection
  lastSyncedOn: Timestamp
  lastActor?: PersonId
  error?: Record<string, any>
  retryAfter?: Timestamp
}

export const githubNextIntegrationKind = 'github-next' as IntegrationKind
export const githubNextUserIntegrationKind = 'github-next-user' as IntegrationKind
export const githubNextIntegrationSettingValue = 'github-next'
export const githubNextId = 'github-next' as Plugin

export default plugin(githubNextId, {
  integrationType: {
    GithubNext: '' as Ref<IntegrationType>
  },
  class: {
    GithubNextRepository: '' as Ref<Class<GithubNextRepository>>,
    GithubNextObjectSyncState: '' as Ref<Class<GithubNextObjectSyncState>>
  },
  ids: {
    GithubNextIssueProvider: '' as Ref<IntegrationSlotProvider>,
    GithubNextDiscussionProvider: '' as Ref<IntegrationSlotProvider>
  },
  kind: {
    GithubNext: '' as IntegrationKind,
    GithubNextUser: '' as IntegrationKind
  },
  metadata: {
    GithubClientID: '' as Metadata<string>,
    GithubNextURL: '' as Metadata<string>
  }
})
