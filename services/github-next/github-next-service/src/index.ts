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

import { getClient as getAccountClient, type Integration, type IntegrationSecret } from '@hcengineering/account-client'
import { createMarkupOperations, createRestTxOperations, type MarkupOperations, type MarkupRef } from '@hcengineering/api-client'
import chunter, { type ChatMessage } from '@hcengineering/chunter'
import communication, { communicationId } from '@hcengineering/communication'
import { createRestClient as createCommunicationRestClient } from '@hcengineering/communication-rest-client'
import { loadMessages } from '@hcengineering/communication-shared'
import { MessageType, SortingOrder, type CardID, type MessageID, type SocialID } from '@hcengineering/communication-types'
import { getClient as getCollaboratorClient } from '@hcengineering/collaborator-client'
import contact, { type Person } from '@hcengineering/contact'
import core, {
  type AttachedData,
  buildSocialIdString,
  type Class,
  concatLink,
  makeCollabId,
  type Markup,
  SocialIdType,
  systemAccountUuid,
  TxOperations,
  type Doc,
  type MeasureContext,
  type PersonId,
  type Ref,
  type Space,
  type Tx,
  type TxCUD,
  type TxCreateDoc,
  type TxDomainEvent,
  type TxWorkspaceEvent,
  type WorkspaceUuid
} from '@hcengineering/core'
import githubNext, {
  githubNextIntegrationKind,
  githubNextIntegrationSettingValue,
  type GithubNextAssignee,
  type GithubNextDiscussion,
  type GithubNextIntegrationData,
  type GithubNextIssue,
  type GithubNextObjectSyncState,
  type GithubNextRepository,
  type GithubNextRepositorySelection
} from '@hcengineering/github-next'
import integration, {
  applyIntegrationSlotBinding,
  applyIntegrationSlotReverseBinding,
  createIntegrationTarget,
  getIntegrationTargetCommentBackend,
  isIntegrationSlotBindingComplete,
  resolveIntegrationRoute,
  updateIntegrationTarget,
  type IntegrationRoutingPolicy,
  type IntegrationSlotBinding,
  type IntegrationSlotProvider,
  type IntegrationTargetContext
} from '@hcengineering/integration'
import { getWorkspaceClient as getHulylakeWorkspaceClient } from '@hcengineering/hulylake-client'
import { generateToken } from '@hcengineering/server-token'
import setting, { type Integration as WorkspaceIntegration } from '@hcengineering/setting'
import tags from '@hcengineering/tags'
import { jsonToMarkup, markupToJSON } from '@hcengineering/text'
import { markdownToMarkup, markupToMarkdown } from '@hcengineering/text-markdown'
import config from './config'
import {
  createGithubDiscussion,
  createGithubIssue,
  createGithubIssueComment,
  deleteGithubIssueComment,
  findGithubUserLoginByEmail,
  findGithubUserLoginByName,
  type GithubIssueComment,
  createGithubRequestContext,
  getGithubDiscussion,
  getGithubIssue,
  getGithubUser,
  listGithubDiscussionCategories,
  listGithubDiscussions,
  listGithubIssueComments,
  listGithubIssues,
  patchGithubIssue,
  updateGithubIssueComment,
  updateGithubDiscussion,
  type GithubRequestContext
} from './github'

export * from './github'

type SyncKind = 'issue' | 'discussion'

export interface SyncGithubNextWorkspaceResult {
  integrations: number
  repositories: number
  issuesSeen: number
  discussionsSeen: number
  created: number
  updated: number
  skipped: number
}

interface ProviderContext {
  provider: IntegrationSlotProvider
  binding: IntegrationSlotBinding
  policy: IntegrationRoutingPolicy
}

interface WorkspaceContext {
  client: TxOperations
  markup: GithubNextMarkupOperations
  communication: GithubNextCommunicationOperations
  workspaceIntegration: WorkspaceIntegration
  repositoryDoc: GithubNextRepository
  providerContext: ProviderContext
}

interface OutboundRoute {
  repository: GithubNextRepository
  target: {
    space: Ref<Space>
    targetClass: Ref<Class<Doc>>
  }
}

type GithubNextIntegrationTargetContext = IntegrationTargetContext & {
  markup: GithubNextMarkupOperations
}

type GithubNextMarkupOperations = MarkupOperations & {
  fetchCurrentMarkup: (
    objectClass: Ref<Class<Doc>>,
    objectId: Ref<Doc>,
    objectAttr: string,
    format: 'markup' | 'markdown'
  ) => Promise<string>
  updateMarkup: (
    objectClass: Ref<Class<Doc>>,
    objectId: Ref<Doc>,
    objectAttr: string,
    markup: string,
    format: 'markup'
  ) => Promise<void>
}

interface GithubNextCommunicationComment {
  id: MessageID
  content: string
  created: Date
  creator: SocialID
}

interface GithubNextCommunicationOperations {
  findTextComments: (doc: Doc) => Promise<GithubNextCommunicationComment[]>
  createTextComment: (
    doc: Doc,
    content: string,
    socialId: SocialID,
    messageId?: MessageID,
    date?: Date
  ) => Promise<MessageID | undefined>
  updateTextComment: (doc: Doc, messageId: MessageID, content: string, socialId: SocialID, date?: Date) => Promise<void>
  removeTextComment: (doc: Doc, messageId: MessageID, socialId: SocialID, date?: Date) => Promise<void>
}

interface GithubNextCommentSyncCache {
  communicationComments?: GithubNextCommunicationComment[]
}

function createGithubNextMarkupOperations (
  url: string,
  workspace: WorkspaceUuid,
  token: string
): GithubNextMarkupOperations {
  const markup = createMarkupOperations(url, workspace, token, {
    ACCOUNTS_URL: config.AccountsURL,
    COLLABORATOR_URL: config.CollaboratorURL,
    FILES_URL: '',
    UPLOAD_URL: ''
  })
  const collaborator = getCollaboratorClient(workspace, token, config.CollaboratorURL)
  const refUrl = concatLink(url, `/browse?workspace=${workspace}`)
  const imageUrl = concatLink(url, `/files?workspace=${workspace}&file=`)

  return {
    fetchMarkup: markup.fetchMarkup.bind(markup),
    uploadMarkup: markup.uploadMarkup.bind(markup),
    fetchCurrentMarkup: async (objectClass, objectId, objectAttr, format) => {
      const currentMarkup = await collaborator.getMarkup(makeCollabId(objectClass, objectId, objectAttr), null)
      switch (format) {
        case 'markup':
          return currentMarkup
        case 'markdown':
          return markupToMarkdown(markupToJSON(currentMarkup), { refUrl, imageUrl })
      }
    },
    updateMarkup: async (objectClass, objectId, objectAttr, value, format) => {
      if (format !== 'markup') {
        throw new Error('Unknown content format')
      }
      await collaborator.updateMarkup(makeCollabId(objectClass, objectId, objectAttr), value as Markup)
    }
  }
}

function createGithubNextCommunicationOperations (
  endpoint: string,
  workspace: WorkspaceUuid,
  token: string
): GithubNextCommunicationOperations {
  const client = createCommunicationRestClient(endpoint, workspace, token)
  const hulylake = getHulylakeWorkspaceClient(config.HulylakeURL, workspace, token)

  return {
    findTextComments: async (doc) => {
      const cardId = doc._id as CardID
      const metas = await client.findMessagesMeta({
        cardId,
        order: SortingOrder.Ascending
      })
      const comments: GithubNextCommunicationComment[] = []

      for (const meta of metas) {
        const messages = await loadMessages(
          hulylake,
          meta.blobId,
          {
            cardId,
            id: meta.id,
            order: SortingOrder.Ascending
          },
          {
            attachments: false,
            reactions: false,
            threads: false
          }
        )
        const message = messages.find((it) => it.id === meta.id)
        if (message?.type !== MessageType.Text) continue
        comments.push({
          id: message.id,
          content: message.content,
          created: message.created,
          creator: message.creator
        })
      }

      return comments.sort(compareCommunicationComments)
    },
    createTextComment: async (doc, content, socialId, messageId, date) => {
      const result = await client.createMessage(
        doc._id as CardID,
        doc._class,
        content,
        MessageType.Text,
        undefined,
        socialId,
        date,
        messageId,
        {
          noNotify: true
        }
      )
      return result.messageId
    },
    updateTextComment: async (doc, messageId, content, socialId, date) => {
      await client.updateMessage(doc._id as CardID, messageId, content, undefined, socialId, date, {
        ignoreMentions: true
      })
    },
    removeTextComment: async (doc, messageId, socialId, date) => {
      await client.removeMessage(doc._id as CardID, messageId, socialId, date)
    }
  }
}

async function createWorkspaceClient (
  accountsUrl: string,
  workspaceUuid: WorkspaceUuid
): Promise<{ client: TxOperations, markup: GithubNextMarkupOperations, communication: GithubNextCommunicationOperations }> {
  const serviceToken = generateToken(systemAccountUuid, workspaceUuid, { service: 'github-next' })
  const accountClient = getAccountClient(accountsUrl, serviceToken)
  const loginInfo = await accountClient.getLoginInfoByToken()
  if (loginInfo == null || !('endpoint' in loginInfo)) {
    throw new Error(`Failed to resolve workspace endpoint for ${workspaceUuid}`)
  }

  const endpoint = loginInfo.endpoint.replace('ws://', 'http://').replace('wss://', 'https://')
  const restClient = await createRestTxOperations(endpoint, loginInfo.workspace, loginInfo.token, true)
  const client = new TxOperations(restClient.client, core.account.System)
  const markup = createGithubNextMarkupOperations(config.FrontURL, loginInfo.workspace, loginInfo.token)
  const communication = createGithubNextCommunicationOperations(endpoint, loginInfo.workspace, loginInfo.token)
  console.info('[github-next-service] workspace client created', {
    workspaceUuid,
    account: loginInfo.account,
    socialId: loginInfo.socialId,
    rawUser: restClient.user,
    actor: client.user
  })
  return { client, markup, communication }
}

async function getWorkspaceIntegration (client: TxOperations): Promise<WorkspaceIntegration | undefined> {
  return await client.findOne(setting.class.Integration, {
    type: githubNext.integrationType.GithubNext,  
    value: githubNextIntegrationSettingValue
  })
}

async function getProviderContext (
  client: TxOperations,
  workspaceIntegration: WorkspaceIntegration,
  providerId: Ref<IntegrationSlotProvider>
): Promise<ProviderContext | undefined> {
  const provider = await client.findOne(integration.class.IntegrationSlotProvider, {
    _id: providerId
  })
  if (provider === undefined) {
    return undefined
  }

  const binding = await client.findOne(integration.class.IntegrationSlotBinding, { provider: provider._id })
  if (binding === undefined || !isIntegrationSlotBindingComplete(provider, binding)) {
    return undefined
  }

  const policy = await client.findOne(integration.class.IntegrationRoutingPolicy, {
    integration: workspaceIntegration._id,
    provider: provider._id
  })
  if (policy === undefined) {
    return undefined
  }

  return { provider, binding, policy }
}

function sortValue (value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = sortValue((value as Record<string, unknown>)[key])
    }
    return result
  }
  return value
}

function stableHash (value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function isStableEqual (left: unknown, right: unknown): boolean {
  return stableHash(left) === stableHash(right)
}

function withoutUndefined (value: Record<string, any>): any {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function hasDefinedValue (value: Record<string, unknown>): boolean {
  return Object.values(value).some((item) => item !== undefined)
}

function getObjectModifiedOn (doc: Doc | undefined): number {
  const modifiedOn = (doc as (Doc & { modifiedOn?: number }) | undefined)?.modifiedOn
  return typeof modifiedOn === 'number' ? modifiedOn : 0
}

function getExternalUpdatedOn (state: Pick<GithubNextObjectSyncState, 'externalUpdatedAt'> | undefined): number {
  return typeof state?.externalUpdatedAt === 'number' ? state.externalUpdatedAt : 0
}

function getSlotTargetAttr (binding: IntegrationSlotBinding, slot: string): string | undefined {
  return binding.bindings[slot]
}

function hasSnapshotValues (state: GithubNextObjectSyncState): boolean {
  return state.externalValues !== undefined && state.targetValues !== undefined
}

function isValueChangedFromSnapshot (
  values: Record<string, unknown>,
  snapshot: Record<string, unknown> | undefined,
  key: string,
  fallbackChanged: boolean
): boolean {
  if (snapshot === undefined) return fallbackChanged
  return !isStableEqual(normalizeComparableValue(values[key]), normalizeComparableValue(snapshot[key]))
}

function getInboundWinningTargetValues (
  binding: IntegrationSlotBinding,
  incomingValues: Record<string, unknown>,
  currentValues: Record<string, unknown>,
  state: GithubNextObjectSyncState,
  localModifiedOn: number
): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  const hasSnapshots = hasSnapshotValues(state)
  const externalChangedFallback = state.externalHash !== stableHash(incomingValues)
  const localChangedFallback = state.targetHash !== stableHash(currentValues)
  const externalUpdatedOn = getExternalUpdatedOn(state)

  for (const targetAttr of Object.values(binding.bindings)) {
    if (!(targetAttr in incomingValues)) continue

    const externalChanged = isValueChangedFromSnapshot(
      incomingValues,
      state.externalValues,
      targetAttr,
      externalChangedFallback
    )
    if (!externalChanged) continue

    const localChanged = isValueChangedFromSnapshot(
      currentValues,
      state.targetValues,
      targetAttr,
      localChangedFallback
    )
    if (!hasSnapshots && localChanged) continue
    if (!localChanged || externalUpdatedOn >= localModifiedOn) {
      changes[targetAttr] = incomingValues[targetAttr]
    }
  }

  return changes
}

function getOutboundWinningIssuePatch (
  binding: IntegrationSlotBinding,
  fullPatch: {
    title?: string
    body?: string
    state?: 'open' | 'closed'
    assignees?: string[]
    labels?: string[]
  },
  currentTargetValues: Record<string, unknown>,
  externalMappedValues: Record<string, unknown>,
  state: GithubNextObjectSyncState,
  localModifiedOn: number
): {
    title?: string
    body?: string
    state?: 'open' | 'closed'
    assignees?: string[]
    labels?: string[]
  } {
  const hasSnapshots = hasSnapshotValues(state)
  const localChangedFallback = state.targetHash !== stableHash(currentTargetValues)
  const externalChangedFallback = state.externalHash !== stableHash(externalMappedValues)
  const externalUpdatedOn = getExternalUpdatedOn(state)

  const isLocalWinner = (slot: string): boolean => {
    const targetAttr = getSlotTargetAttr(binding, slot)
    if (targetAttr === undefined) return false
    if (isStableEqual(
      normalizeComparableValue(currentTargetValues[targetAttr]),
      normalizeComparableValue(externalMappedValues[targetAttr])
    )) {
      return false
    }

    const localChanged = isValueChangedFromSnapshot(
      currentTargetValues,
      state.targetValues,
      targetAttr,
      localChangedFallback
    )
    if (!localChanged) return false

    const externalChanged = isValueChangedFromSnapshot(
      externalMappedValues,
      state.externalValues,
      targetAttr,
      externalChangedFallback
    )
    if (!hasSnapshots && externalChanged) return false

    return !externalChanged || localModifiedOn >= externalUpdatedOn
  }

  return {
    title: isLocalWinner('title') ? fullPatch.title : undefined,
    body: isLocalWinner('description') ? fullPatch.body : undefined,
    state: isLocalWinner('state') ? fullPatch.state : undefined,
    assignees: isLocalWinner('assignee') ? fullPatch.assignees : undefined,
    labels: isLocalWinner('labels') ? fullPatch.labels : undefined
  }
}

function getOutboundExternalWinningTargetValues (
  binding: IntegrationSlotBinding,
  currentTargetValues: Record<string, unknown>,
  externalMappedValues: Record<string, unknown>,
  state: GithubNextObjectSyncState,
  localModifiedOn: number
): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  const hasSnapshots = hasSnapshotValues(state)
  const localChangedFallback = state.targetHash !== stableHash(currentTargetValues)
  const externalChangedFallback = state.externalHash !== stableHash(externalMappedValues)
  const externalUpdatedOn = getExternalUpdatedOn(state)

  for (const targetAttr of Object.values(binding.bindings)) {
    if (!(targetAttr in externalMappedValues)) continue

    const externalChanged = isValueChangedFromSnapshot(
      externalMappedValues,
      state.externalValues,
      targetAttr,
      externalChangedFallback
    )
    if (!externalChanged) continue

    const localChanged = isValueChangedFromSnapshot(
      currentTargetValues,
      state.targetValues,
      targetAttr,
      localChangedFallback
    )
    if (!hasSnapshots && localChanged) continue
    if (!localChanged || externalUpdatedOn > localModifiedOn) {
      changes[targetAttr] = externalMappedValues[targetAttr]
    }
  }

  return changes
}

function getOutboundWinningDiscussionPatch (
  binding: IntegrationSlotBinding,
  fullPatch: {
    title?: string
    body?: string
    categoryId?: string
  },
  currentTargetValues: Record<string, unknown>,
  externalMappedValues: Record<string, unknown>,
  state: GithubNextObjectSyncState,
  localModifiedOn: number
): {
    title?: string
    body?: string
    categoryId?: string
  } {
  const hasSnapshots = hasSnapshotValues(state)
  const localChangedFallback = state.targetHash !== stableHash(currentTargetValues)
  const externalChangedFallback = state.externalHash !== stableHash(externalMappedValues)
  const externalUpdatedOn = getExternalUpdatedOn(state)

  const isLocalWinner = (slot: string): boolean => {
    const targetAttr = getSlotTargetAttr(binding, slot)
    if (targetAttr === undefined) return false
    if (isStableEqual(
      normalizeComparableValue(currentTargetValues[targetAttr]),
      normalizeComparableValue(externalMappedValues[targetAttr])
    )) {
      return false
    }

    const localChanged = isValueChangedFromSnapshot(
      currentTargetValues,
      state.targetValues,
      targetAttr,
      localChangedFallback
    )
    if (!localChanged) return false

    const externalChanged = isValueChangedFromSnapshot(
      externalMappedValues,
      state.externalValues,
      targetAttr,
      externalChangedFallback
    )
    if (!hasSnapshots && externalChanged) return false

    return !externalChanged || localModifiedOn >= externalUpdatedOn
  }

  return {
    title: isLocalWinner('title') ? fullPatch.title : undefined,
    body: isLocalWinner('description') ? fullPatch.body : undefined,
    categoryId: isLocalWinner('category') ? fullPatch.categoryId : undefined
  }
}

function getRepositoryKey (repository: Pick<GithubNextRepository, 'owner' | 'name'>): string {
  return `${repository.owner}/${repository.name}`
}

function getOutboundTargetKey (target: { space: Ref<Space>, targetClass: Ref<Class<Doc>> }): string {
  return `${target.targetClass}:${target.space}`
}

function getIssueCommentExternalId (issueExternalId: string, commentId: number): string {
  return `issue:${issueExternalId}:comment:${commentId}`
}

function getIssueCommentIdFromExternalId (issueExternalId: string): number | undefined {
  const commentId = Number(issueExternalId.split(':comment:')[1])
  return Number.isFinite(commentId) ? commentId : undefined
}

function isIssueCommentExternalId (externalId: string): boolean {
  return externalId.includes(':comment:')
}

function isTxCUD (tx: Tx): tx is TxCUD<Doc> {
  return (
    tx._class === core.class.TxCreateDoc ||
    tx._class === core.class.TxUpdateDoc ||
    tx._class === core.class.TxRemoveDoc
  )
}

function isTxCreateDoc (tx: Tx): tx is TxCreateDoc<Doc> {
  return tx._class === core.class.TxCreateDoc
}

function isTxDomainEvent (tx: Tx): tx is TxDomainEvent {
  return tx._class === core.class.TxDomainEvent
}

function isTxWorkspaceEvent (tx: Tx): tx is TxWorkspaceEvent {
  return tx._class === core.class.TxWorkspaceEvent
}

function isIgnoredGithubNextInternalClass (objectClass: Ref<Class<Doc>>): boolean {
  return (
    objectClass === githubNext.class.GithubNextObjectSyncState ||
    objectClass === githubNext.class.GithubNextRepository
  )
}

function getTxObjectSpace (tx: TxCUD<Doc>): Ref<Space> | undefined {
  return (tx as unknown as { objectSpace?: Ref<Space>, space?: Ref<Space> }).objectSpace ??
    (tx as unknown as { objectSpace?: Ref<Space>, space?: Ref<Space> }).space
}

function getTxCreateAttributes (tx: TxCreateDoc<Doc>): Record<string, unknown> {
  return (tx as unknown as { attributes?: Record<string, unknown> }).attributes ?? {}
}

async function hasExistingSyncStateForTx (
  client: TxOperations,
  workspaceIntegration: WorkspaceIntegration,
  tx: TxCUD<Doc>
): Promise<boolean> {
  const state = await client.findOne(githubNext.class.GithubNextObjectSyncState, {
    integration: workspaceIntegration._id,
    targetClass: tx.objectClass,
    targetId: tx.objectId
  })
  if (state !== undefined) return true

  if (tx.objectClass !== chunter.class.ChatMessage || !isTxCreateDoc(tx)) return false

  const attrs = getTxCreateAttributes(tx)
  const attachedTo = attrs.attachedTo as Ref<Doc> | undefined
  const attachedToClass = attrs.attachedToClass as Ref<Class<Doc>> | undefined
  if (attachedTo === undefined || attachedToClass === undefined) return false

  return await client.findOne(githubNext.class.GithubNextObjectSyncState, {
    integration: workspaceIntegration._id,
    targetClass: attachedToClass,
    targetId: attachedTo
  }) !== undefined
}

async function matchesOutboundCreateRoute (
  client: TxOperations,
  accountIntegrations: Integration[],
  providerContext: ProviderContext,
  tx: TxCUD<Doc>
): Promise<boolean> {
  if (!isTxCreateDoc(tx)) return false

  const objectSpace = getTxObjectSpace(tx)
  if (objectSpace === undefined) return false
  if (!client.getHierarchy().isDerived(tx.objectClass, providerContext.binding.targetClass)) return false

  for (const accountIntegration of accountIntegrations) {
    const integrationData = accountIntegration.data as GithubNextIntegrationData | undefined
    const repositories = integrationData?.repositories ?? []
    for (const repository of repositories) {
      const target = await resolveIntegrationRoute(providerContext.policy, {}, {
        externalPattern: `${repository.owner}/${repository.name}`,
        targetClass: providerContext.binding.targetClass
      })
      if (
        target?.space === objectSpace &&
        client.getHierarchy().isDerived(tx.objectClass, target.targetClass)
      ) {
        return true
      }
    }
  }

  return false
}

export async function isGithubNextOutboundRelevantTx (
  accountsUrl: string,
  workspaceUuid: WorkspaceUuid,
  tx: Tx
): Promise<boolean> {
  if (isTxWorkspaceEvent(tx)) return false
  if (tx.modifiedBy === core.account.System) return false
  if (isTxDomainEvent(tx)) return tx.domain === 'communication'
  if (!isTxCUD(tx)) return false
  if (isIgnoredGithubNextInternalClass(tx.objectClass)) return false

  const serviceToken = generateToken(systemAccountUuid, workspaceUuid, { service: 'github-next' })
  const accountClient = getAccountClient(accountsUrl, serviceToken)
  const accountIntegrations = await accountClient.listIntegrations({
    kind: githubNextIntegrationKind,
    workspaceUuid
  })
  if (accountIntegrations.length === 0) return false

  const { client } = await createWorkspaceClient(accountsUrl, workspaceUuid)
  try {
    const workspaceIntegration = await getWorkspaceIntegration(client)
    if (workspaceIntegration === undefined) return false
    if (await hasExistingSyncStateForTx(client, workspaceIntegration, tx)) return true

    const issueProvider = await getProviderContext(client, workspaceIntegration, githubNext.ids.GithubNextIssueProvider)
    const matchesIssueRoute =
      issueProvider !== undefined && (await matchesOutboundCreateRoute(client, accountIntegrations, issueProvider, tx))
    if (matchesIssueRoute) {
      return true
    }

    const discussionProvider = await getProviderContext(
      client,
      workspaceIntegration,
      githubNext.ids.GithubNextDiscussionProvider
    )
    return discussionProvider !== undefined &&
      (await matchesOutboundCreateRoute(client, accountIntegrations, discussionProvider, tx))
  } finally {
    await client.close()
  }
}

async function isCommunicationPluginEnabled (client: TxOperations): Promise<boolean> {
  const hasCommunicationModel = client.getModel().findObject(communication.class.MessageAction) !== undefined
  if (!hasCommunicationModel) return false

  const pluginConfig = await client.findOne(core.class.PluginConfiguration, { pluginId: communicationId })
  return pluginConfig?.enabled !== false
}

async function resolveCommentBackend (
  client: TxOperations,
  workspaceIntegration: WorkspaceIntegration,
  providerContext: ProviderContext,
  doc: Doc
): Promise<{ useCommunication: boolean, requestedBackend: string, communicationEnabled: boolean }> {
  const requestedBackend = await getIntegrationTargetCommentBackend(
    {
      client,
      integration: workspaceIntegration._id,
      provider: providerContext.provider._id
    },
    doc
  )
  const communicationEnabled = requestedBackend === 'communication' && (await isCommunicationPluginEnabled(client))
  const useCommunication = requestedBackend === 'communication' && communicationEnabled

  return {
    useCommunication,
    requestedBackend,
    communicationEnabled
  }
}

function normalizeIdentityValue (value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function normalizeIdentityName (value: string | undefined): string {
  return normalizeIdentityValue(value).replace(/\s+/g, '')
}

function getNameVariants (name: string | undefined): Set<string> {
  const variants = new Set<string>()
  const normalized = normalizeIdentityName(name)
  if (normalized !== '') variants.add(normalized.replace(/,/g, ''))

  const parts = normalizeIdentityValue(name)
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (parts.length >= 2) {
    variants.add(`${parts[0]}${parts.slice(1).join('')}`)
    variants.add(`${parts.slice(1).join('')}${parts[0]}`)
  }

  return variants
}

function getPersonSearchNames (person: Person): string[] {
  const rawName = person.name ?? ''
  const [lastName = '', firstName = ''] = rawName.split(',')
  return [
    rawName,
    `${firstName} ${lastName}`,
    `${lastName} ${firstName}`
  ].map((name) => name.trim()).filter((name) => name !== '')
}

async function findPersonByEmail (client: TxOperations, email: string | undefined): Promise<Ref<Person> | undefined> {
  const normalizedEmail = normalizeIdentityValue(email)
  if (normalizedEmail === '') return undefined

  const socialKey = buildSocialIdString({ type: SocialIdType.EMAIL, value: normalizedEmail })
  const socialIdentityByKey = await client.findOne(contact.class.SocialIdentity, {
    key: socialKey,
    attachedToClass: contact.class.Person
  })
  const socialIdentity = socialIdentityByKey ?? await client.findOne(contact.class.SocialIdentity, {
    type: SocialIdType.EMAIL,
    value: normalizedEmail,
    attachedToClass: contact.class.Person
  })

  return socialIdentity?.attachedTo
}

async function findPersonByName (client: TxOperations, name: string | undefined): Promise<Ref<Person> | undefined> {
  const searchVariants = getNameVariants(name)
  if (searchVariants.size === 0) return undefined

  const persons = await client.findAll<Person>(contact.class.Person, {})
  const matches = persons.filter((person) =>
    getPersonSearchNames(person).some((personName) => {
      for (const variant of getNameVariants(personName)) {
        if (searchVariants.has(variant)) return true
      }
      return false
    })
  )

  return matches.length === 1 ? matches[0]._id : undefined
}

async function resolveGithubAssigneeToPerson (
  client: TxOperations,
  assignee: GithubNextAssignee | undefined
): Promise<Ref<Person> | undefined> {
  const login = assignee?.login
  if (login == null || login.trim() === '') return undefined

  const githubLogin = login.trim().toLowerCase()
  const socialKey = buildSocialIdString({ type: SocialIdType.GITHUB, value: githubLogin })
  const socialIdentityByKey = await client.findOne(contact.class.SocialIdentity, {
    key: socialKey,
    attachedToClass: contact.class.Person
  })
  const socialIdentity = socialIdentityByKey ?? await client.findOne(contact.class.SocialIdentity, {
    type: SocialIdType.GITHUB,
    value: githubLogin,
    attachedToClass: contact.class.Person
  })

  if (socialIdentity !== undefined) {
    console.info('[github-next-service] assignee inbound resolved by GitHub social identity', {
      login,
      normalizedLogin: githubLogin,
      socialKey,
      socialIdentity: socialIdentity._id,
      attachedTo: socialIdentity.attachedTo,
      resolvedBy: socialIdentityByKey !== undefined ? 'key' : 'type-value'
    })
    return socialIdentity.attachedTo
  }

  const emailPerson = await findPersonByEmail(client, assignee?.email)
  if (emailPerson !== undefined) {
    console.info('[github-next-service] assignee inbound resolved by email', {
      login,
      email: assignee?.email,
      attachedTo: emailPerson
    })
    return emailPerson
  }

  const namePerson = await findPersonByName(client, assignee?.name)
  if (namePerson !== undefined) {
    console.info('[github-next-service] assignee inbound resolved by name', {
      login,
      name: assignee?.name,
      attachedTo: namePerson
    })
    return namePerson
  }

  console.warn('[github-next-service] assignee inbound person not found', {
    login,
    normalizedLogin: githubLogin,
    socialKey,
    email: assignee?.email,
    name: assignee?.name
  })
  return undefined
}

async function resolveGithubLoginToSocialId (
  client: TxOperations,
  login: string | undefined
): Promise<PersonId | undefined> {
  if (login == null || login.trim() === '') return undefined

  const githubLogin = login.trim().toLowerCase()
  const socialKey = buildSocialIdString({ type: SocialIdType.GITHUB, value: githubLogin })
  const socialIdentity = await client.findOne(contact.class.SocialIdentity, {
    key: socialKey,
    attachedToClass: contact.class.Person
  }) ?? await client.findOne(contact.class.SocialIdentity, {
    type: SocialIdType.GITHUB,
    value: githubLogin,
    attachedToClass: contact.class.Person
  })
  return socialIdentity?._id
}

async function resolvePersonToAnySocialId (
  client: TxOperations,
  person: Ref<Person> | undefined
): Promise<PersonId | undefined> {
  if (person === undefined) return undefined

  const socialIds = await client.findAll(contact.class.SocialIdentity, {
    attachedTo: person,
    attachedToClass: contact.class.Person
  })
  const socialId = (
    socialIds.find((socialId) => socialId.type === SocialIdType.GITHUB)?._id ??
    socialIds.find((socialId) => socialId.type === SocialIdType.EMAIL)?._id ??
    socialIds[0]?._id
  )
  return socialId as PersonId | undefined
}

async function resolveGithubCommentAuthorToSocialId (
  client: TxOperations,
  token: string,
  login: string | undefined,
  githubContext?: GithubRequestContext
): Promise<PersonId | undefined> {
  const direct = await resolveGithubLoginToSocialId(client, login)
  if (direct !== undefined) {
    console.info('[github-next-service] comment author resolved by GitHub social identity', {
      login,
      socialIdentity: direct
    })
    return direct
  }

  if (login == null || login.trim() === '') return undefined

  try {
    const githubUser = await getGithubUser(token, login, githubContext)
    const person = await resolveGithubAssigneeToPerson(client, githubUser)
    const socialId = await resolvePersonToAnySocialId(client, person)
    console.info('[github-next-service] comment author resolved by person mapping', {
      login,
      email: githubUser.email,
      name: githubUser.name,
      person,
      socialId
    })
    return socialId
  } catch (err) {
    console.warn('[github-next-service] comment author lookup failed', {
      login,
      err
    })
    return undefined
  }
}

async function resolvePersonToGithubLogin (
  client: TxOperations,
  token: string | undefined,
  person: Ref<Person> | null | undefined,
  githubContext?: GithubRequestContext
): Promise<string | undefined> {
  if (person == null) return undefined

  const socialIds = await client.findAll(contact.class.SocialIdentity, {
    attachedTo: person,
    attachedToClass: contact.class.Person
  })
  const githubSocialIds = socialIds.filter((socialId) => socialId.type === SocialIdType.GITHUB)
  const login = githubSocialIds[0]?.value
  if (login !== undefined) {
    console.info('[github-next-service] assignee outbound resolved', {
      person,
      login,
      socialIdentity: githubSocialIds[0]?._id
    })
    return login
  }

  if (token !== undefined) {
    const emailSocialIds = socialIds.filter((socialId) => socialId.type === SocialIdType.EMAIL)
    for (const emailSocialId of emailSocialIds) {
      const loginByEmail = await findGithubUserLoginByEmail(token, emailSocialId.value, githubContext)
      if (loginByEmail !== undefined) {
        console.info('[github-next-service] assignee outbound resolved by email', {
          person,
          email: emailSocialId.value,
          login: loginByEmail
        })
        return loginByEmail
      }
    }

    const personDoc = await client.findOne<Person>(contact.class.Person, { _id: person })
    if (personDoc !== undefined) {
      for (const name of getPersonSearchNames(personDoc)) {
        const loginByName = await findGithubUserLoginByName(token, name, githubContext)
        if (loginByName !== undefined) {
          console.info('[github-next-service] assignee outbound resolved by name', {
            person,
            name,
            login: loginByName
          })
          return loginByName
        }
      }
    }
  }

  console.warn('[github-next-service] assignee outbound GitHub user not found', {
    person,
    socialIds: socialIds.map((socialId) => ({
      id: socialId._id,
      type: socialId.type,
      value: socialId.value,
      key: socialId.key
    }))
  })
  return undefined
}

async function getDocLabelTitles (client: TxOperations, doc: Doc, collection: string): Promise<string[]> {
  const refs = await client.findAll(tags.class.TagReference, {
    attachedTo: doc._id,
    attachedToClass: doc._class,
    collection
  })
  return refs.map((ref) => ref.title).filter((title) => title !== '')
}

async function fetchMappedTargetValues (
  client: TxOperations,
  markup: MarkupOperations,
  doc: Doc,
  binding: IntegrationSlotBinding,
  markupFormat: 'markup' | 'markdown' = 'markdown'
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {}

  for (const targetAttr of Object.values(binding.bindings)) {
    const rawValue = (doc as unknown as Record<string, unknown>)[targetAttr]
    if (targetAttr === 'description' || targetAttr === 'content') {
      values[targetAttr] = await fetchTargetMarkup(markup, doc, targetAttr, rawValue, markupFormat)
      continue
    }

    if (targetAttr === 'labels') {
      values[targetAttr] = await getDocLabelTitles(client, doc, targetAttr)
      continue
    }

    values[targetAttr] = rawValue
  }

  return values
}

async function fetchTargetMarkup (
  markup: MarkupOperations,
  doc: Doc,
  targetAttr: string,
  rawValue: unknown,
  markupFormat: 'markup' | 'markdown'
): Promise<string | undefined> {
  const currentReader = (markup as Partial<GithubNextMarkupOperations>).fetchCurrentMarkup
  if (currentReader !== undefined) {
    try {
      return await currentReader(doc._class, doc._id, targetAttr, markupFormat)
    } catch (err) {
      console.warn('[github-next-service] failed to fetch current markup, falling back to blob ref', {
        objectClass: doc._class,
        objectId: doc._id,
        objectAttr: targetAttr,
        err
      })
    }
  }

  if (typeof rawValue === 'string' && rawValue !== '') {
    return await markup.fetchMarkup(doc._class, doc._id, targetAttr, rawValue as MarkupRef, markupFormat)
  }

  return undefined
}

async function getTargetHash (
  client: TxOperations,
  markup: MarkupOperations,
  doc: Doc,
  binding: IntegrationSlotBinding
): Promise<string> {
  return stableHash(await fetchMappedTargetValues(client, markup, doc, binding, 'markup'))
}

function normalizeDiscussionSlots (discussion: GithubNextDiscussion): Record<string, unknown> {
  return {
    title: discussion.title,
    description: discussion.body !== undefined ? jsonToMarkup(markdownToMarkup(discussion.body)) : undefined,
    category: discussion.category?.name,
    state: discussion.state,
    externalUrl: discussion.htmlUrl,
    number: discussion.number
  }
}

async function normalizeIssueSlots (
  client: TxOperations,
  issue: GithubNextIssue
): Promise<Record<string, unknown>> {
  const assignee = issue.assignees?.[0] !== undefined
    ? await resolveGithubAssigneeToPerson(client, issue.assignees[0])
    : undefined

  return {
    title: issue.title,
    description: issue.body !== undefined ? jsonToMarkup(markdownToMarkup(issue.body)) : undefined,
    state: issue.state,
    externalUrl: issue.htmlUrl,
    number: issue.number,
    assignee,
    labels: issue.labels ?? []
  }
}

async function ensureRepositoryDocs (
  ctx: MeasureContext,
  client: TxOperations,
  workspaceIntegration: WorkspaceIntegration,
  repositories: GithubNextRepositorySelection[]
): Promise<Map<string, GithubNextRepository>> {
  const existing = await client.findAll(githubNext.class.GithubNextRepository, {
    integration: workspaceIntegration._id
  })
  const repositoryByKey = new Map<string, GithubNextRepository>(existing.map((doc) => [`${doc.owner}/${doc.name}`, doc]))
  const selectedKeys = new Set(repositories.map((repository) => `${repository.owner}/${repository.name}`))

  for (const repository of repositories) {
    const key = `${repository.owner}/${repository.name}`
    const existingDoc = repositoryByKey.get(key)

    if (existingDoc === undefined) {
      const data = withoutUndefined({
        integration: workspaceIntegration._id,
        owner: repository.owner,
        name: repository.name,
        repositoryId: repository.repositoryId,
        nodeId: repository.nodeId,
        htmlUrl: repository.htmlUrl,
        defaultBranch: repository.defaultBranch,
        enabled: true
      })
      ctx.info('Creating GitHub Next repository doc', {
        repository: key,
        actor: client.user,
        data
      })
      try {
        const id = await client.createDoc(githubNext.class.GithubNextRepository, core.space.Workspace, data)
        const created = await client.findOne(githubNext.class.GithubNextRepository, { _id: id })
        if (created !== undefined) repositoryByKey.set(key, created)
      } catch (err) {
        ctx.error('Failed to create GitHub Next repository doc', {
          repository: key,
          data,
          err
        })
        continue
      }
    } else {
      const update = withoutUndefined({
        repositoryId: repository.repositoryId,
        nodeId: repository.nodeId,
        htmlUrl: repository.htmlUrl,
        defaultBranch: repository.defaultBranch,
        enabled: true
      })
      try {
        await client.update(existingDoc, update)
      } catch (err) {
        ctx.error('Failed to update GitHub Next repository doc', {
          repository: key,
          update,
          err
        })
        continue
      }
      repositoryByKey.set(key, { ...existingDoc, ...repository, enabled: true })
    }
  }

  for (const existingDoc of existing) {
    const key = `${existingDoc.owner}/${existingDoc.name}`
    if (!selectedKeys.has(key) && existingDoc.enabled) {
      await client.update(existingDoc, { enabled: false })
      repositoryByKey.set(key, { ...existingDoc, enabled: false })
    }
  }

  return repositoryByKey
}

async function getOutboundRoutes (
  ctx: MeasureContext,
  providerContext: ProviderContext,
  repositories: Iterable<GithubNextRepository>
): Promise<OutboundRoute[]> {
  const routesByTarget = new Map<string, OutboundRoute[]>()

  for (const repository of repositories) {
    if (!repository.enabled) continue

    const target = await resolveIntegrationRoute(providerContext.policy, {}, {
      externalPattern: getRepositoryKey(repository),
      targetClass: providerContext.binding.targetClass
    })
    if (target?.space === undefined) continue

    const route: OutboundRoute = {
      repository,
      target: {
        space: target.space,
        targetClass: target.targetClass
      }
    }
    const key = getOutboundTargetKey(route.target)
    routesByTarget.set(key, [...(routesByTarget.get(key) ?? []), route])
  }

  const routes: OutboundRoute[] = []
  for (const [targetKey, targetRoutes] of routesByTarget) {
    if (targetRoutes.length > 1) {
      ctx.warn('Skipping GitHub Next outbound create for ambiguous target route', {
        target: targetKey,
        repositories: targetRoutes.map((route) => getRepositoryKey(route.repository))
      })
      continue
    }
    const route = targetRoutes[0]
    if (route !== undefined) {
      routes.push(route)
    }
  }

  return routes
}

async function findOutboundTargetDocs (
  client: TxOperations,
  route: OutboundRoute,
  syncedTargetKeys: Set<string>
): Promise<Doc[]> {
  const hierarchy = client.getHierarchy()
  const targetClasses = new Set<Ref<Class<Doc>>>([
    route.target.targetClass,
    ...(hierarchy.getDescendants(route.target.targetClass) as Array<Ref<Class<Doc>>>)
  ])
  const docs: Doc[] = []

  for (const targetClass of targetClasses) {
    const targetDocs = await client.findAll<Doc>(targetClass, { space: route.target.space })
    docs.push(...targetDocs.filter((doc) => !syncedTargetKeys.has(doc._id) && !syncedTargetKeys.has(`${doc._class}:${doc._id}`)))
  }

  return docs
}

async function getSyncedTargetKeys (
  client: TxOperations,
  workspaceIntegration: WorkspaceIntegration,
  provider: IntegrationSlotProvider
): Promise<Set<string>> {
  const states = await client.findAll(githubNext.class.GithubNextObjectSyncState, {
    integration: workspaceIntegration._id,
    provider: provider._id
  })

  return new Set(
    states
      .filter((state) => !state.externalId.includes(':comment:'))
      .flatMap((state) => [state.targetId, `${state.targetClass}:${state.targetId}`])
  )
}

async function getTokenSecret (
  accountsUrl: string,
  accountIntegration: Integration
): Promise<IntegrationSecret | null> {
  const serviceToken = generateToken(systemAccountUuid, accountIntegration.workspaceUuid ?? undefined, { service: 'github-next' })
  const accountClient = getAccountClient(accountsUrl, serviceToken)
  return await accountClient.getIntegrationSecret({
    socialId: accountIntegration.socialId,
    kind: accountIntegration.kind,
    workspaceUuid: accountIntegration.workspaceUuid,
    key: 'token'
  })
}

async function upsertInboundObject (
  ctx: MeasureContext,
  workspace: WorkspaceContext,
  normalizedValues: Record<string, unknown>,
  external: {
    externalId: string
    externalNumber?: number
    externalUrl?: string
    externalNodeId?: string
    externalVersion?: string
  }
): Promise<'created' | 'updated' | 'skipped'> {
  const { binding, policy, provider } = workspace.providerContext
  const target = await resolveIntegrationRoute(policy, normalizedValues, {
    externalPattern: `${workspace.repositoryDoc.owner}/${workspace.repositoryDoc.name}`,
    targetClass: binding.targetClass
  })
  if (target === undefined) {
    ctx.warn('GitHub Next route is not configured', {
      repository: `${workspace.repositoryDoc.owner}/${workspace.repositoryDoc.name}`,
      provider: provider._id
    })
    return 'skipped'
  }

  const mappedValues = applyIntegrationSlotBinding(normalizedValues, binding)
  if (binding.bindings.assignee !== undefined) {
    console.info('[github-next-service] assignee inbound mapped', {
      externalId: external.externalId,
      sourceAssignee: normalizedValues.assignee,
      targetAttr: binding.bindings.assignee,
      targetAssignee: mappedValues[binding.bindings.assignee]
    })
  }
  const mappedHash = stableHash(mappedValues)
  const existingState = await workspace.client.findOne(githubNext.class.GithubNextObjectSyncState, {
    integration: workspace.workspaceIntegration._id,
    provider: provider._id,
    repository: workspace.repositoryDoc._id,
    externalId: external.externalId
  })

  const integrationTargetContext: GithubNextIntegrationTargetContext = {
    client: workspace.client,
    markup: workspace.markup,
    integration: workspace.workspaceIntegration._id,
    provider: provider._id
  }

  const syncUpdate = withoutUndefined({
    externalNumber: external.externalNumber,
    externalUrl: external.externalUrl,
    externalNodeId: external.externalNodeId,
    externalVersion: external.externalVersion,
    externalUpdatedAt: external.externalVersion !== undefined ? Date.parse(external.externalVersion) : undefined,
    externalHash: mappedHash,
    lastDirection: 'inbound' as const,
    lastSyncedOn: Date.now()
  })

  if (existingState === undefined) {
    const createdDoc = await createIntegrationTarget(integrationTargetContext, target, mappedValues)
    const targetValues = await fetchMappedTargetValues(workspace.client, workspace.markup, createdDoc, binding, 'markup')
    await workspace.client.createDoc(githubNext.class.GithubNextObjectSyncState, core.space.Workspace, withoutUndefined({
      integration: workspace.workspaceIntegration._id,
      provider: provider._id,
      repository: workspace.repositoryDoc._id,
      externalId: external.externalId,
      targetClass: createdDoc._class,
      targetId: createdDoc._id,
      targetHash: stableHash(targetValues),
      externalValues: mappedValues,
      targetValues,
      ...syncUpdate
    }))
    return 'created'
  }

  const targetDoc = await workspace.client.findOne(existingState.targetClass, { _id: existingState.targetId })
  if (existingState.externalHash === mappedHash && targetDoc !== undefined) {
    const currentTargetHash = await getTargetHash(workspace.client, workspace.markup, targetDoc, binding)
    if (currentTargetHash === existingState.targetHash) {
      return 'skipped'
    }
  }

  let targetHash = existingState.targetHash
  let targetValues = existingState.targetValues
  if (targetDoc !== undefined) {
    const currentTargetValues = await fetchMappedTargetValues(workspace.client, workspace.markup, targetDoc, binding, 'markup')
    const currentTargetHash = stableHash(currentTargetValues)
    const hasLocalPendingChanges = currentTargetHash !== existingState.targetHash
    const changedValues = getInboundWinningTargetValues(
      binding,
      mappedValues,
      currentTargetValues,
      existingState,
      getObjectModifiedOn(targetDoc)
    )
    if (Object.keys(changedValues).length > 0) {
      ctx.info('GitHub Next inbound target diff prepared', {
        repository: `${workspace.repositoryDoc.owner}/${workspace.repositoryDoc.name}`,
        externalId: external.externalId,
        targetClass: targetDoc._class,
        targetId: targetDoc._id,
        fields: Object.keys(changedValues)
      })
      await updateIntegrationTarget(
        integrationTargetContext,
        targetDoc,
        changedValues
      )
      const updatedTargetDoc = await workspace.client.findOne(existingState.targetClass, { _id: existingState.targetId })
      const updatedTargetValues = updatedTargetDoc !== undefined
        ? await fetchMappedTargetValues(workspace.client, workspace.markup, updatedTargetDoc, binding, 'markup')
        : currentTargetValues
      targetValues = hasLocalPendingChanges && existingState.targetValues !== undefined
        ? { ...existingState.targetValues, ...changedValues }
        : updatedTargetValues
      targetHash = stableHash(targetValues)
    } else {
      if (currentTargetHash === existingState.targetHash) {
        targetHash = currentTargetHash
        targetValues = currentTargetValues
      }
    }
  }

  await workspace.client.update(existingState, withoutUndefined({
    ...syncUpdate,
    targetHash,
    externalValues: mappedValues,
    targetValues
  }))
  return targetHash !== existingState.targetHash || mappedHash !== existingState.externalHash ? 'updated' : 'skipped'
}

function normalizeIssueComment (comment: GithubIssueComment): Record<string, unknown> {
  return {
    body: comment.body ?? '',
    authorLogin: comment.authorLogin,
    htmlUrl: comment.htmlUrl,
    updatedAt: comment.updatedAt,
    createdAt: comment.createdAt
  }
}

function compareGithubIssueComments (left: GithubIssueComment, right: GithubIssueComment): number {
  const leftCreated = Date.parse(left.createdAt)
  const rightCreated = Date.parse(right.createdAt)
  const createdDiff = (Number.isFinite(leftCreated) ? leftCreated : 0) - (Number.isFinite(rightCreated) ? rightCreated : 0)
  return createdDiff !== 0 ? createdDiff : left.id - right.id
}

function compareCommunicationComments (
  left: GithubNextCommunicationComment,
  right: GithubNextCommunicationComment
): number {
  const createdDiff = left.created.getTime() - right.created.getTime()
  return createdDiff !== 0 ? createdDiff : left.id.localeCompare(right.id)
}

function compareChatMessages (left: ChatMessage, right: ChatMessage): number {
  const createdDiff = (left.createdOn ?? 0) - (right.createdOn ?? 0)
  return createdDiff !== 0 ? createdDiff : left._id.localeCompare(right._id)
}

function createMessageIdForGithubComment (comment: GithubIssueComment): MessageID | undefined {
  const created = Date.parse(comment.createdAt)
  if (!Number.isFinite(created)) return undefined

  const entropy = BigInt(comment.id) & ((1n << 20n) - 1n)
  const id = (BigInt(created) << 20n) | entropy
  const buffer = new Uint8Array(8)
  new DataView(buffer.buffer).setBigUint64(0, id, false)
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') as MessageID
}

async function getCachedCommunicationComments (
  workspace: WorkspaceContext,
  issueDoc: Doc,
  cache: GithubNextCommentSyncCache
): Promise<GithubNextCommunicationComment[]> {
  if (cache.communicationComments === undefined) {
    cache.communicationComments = await workspace.communication.findTextComments(issueDoc)
    console.info('[github-next-service] communication comments cache loaded', {
      targetClass: issueDoc._class,
      targetId: issueDoc._id,
      messages: cache.communicationComments.length
    })
  }

  return cache.communicationComments
}

function putCachedCommunicationComment (
  cache: GithubNextCommentSyncCache,
  comment: GithubNextCommunicationComment | undefined
): void {
  if (comment === undefined || cache.communicationComments === undefined) return

  cache.communicationComments = [
    ...cache.communicationComments.filter((it) => it.id !== comment.id),
    comment
  ].sort(compareCommunicationComments)
}

async function upsertInboundIssueComment (
  workspace: WorkspaceContext,
  issueState: GithubNextObjectSyncState,
  issueDoc: Doc,
  comment: GithubIssueComment,
  token: string,
  githubContext: GithubRequestContext,
  cache: GithubNextCommentSyncCache
): Promise<'created' | 'updated' | 'skipped'> {
  const externalId = getIssueCommentExternalId(issueState.externalId, comment.id)
  const normalized = normalizeIssueComment(comment)
  const externalHash = stableHash(normalized)
  const existingState = await workspace.client.findOne(githubNext.class.GithubNextObjectSyncState, {
    integration: workspace.workspaceIntegration._id,
    provider: workspace.providerContext.provider._id,
    repository: workspace.repositoryDoc._id,
    externalId
  })

  const messageMarkup = jsonToMarkup(markdownToMarkup(comment.body ?? ''))
  const messageHash = stableHash({ message: messageMarkup })
  const communicationHash = stableHash({ content: comment.body ?? '' })
  const createdOn = Date.parse(comment.createdAt)
  const modifiedOn = Date.parse(comment.updatedAt)
  const author = await resolveGithubCommentAuthorToSocialId(workspace.client, token, comment.authorLogin, githubContext)
  const backend = await resolveCommentBackend(
    workspace.client,
    workspace.workspaceIntegration,
    workspace.providerContext,
    issueDoc
  )
  const useCommunication = backend.useCommunication && existingState?.targetClass !== chunter.class.ChatMessage
  const existingBackendMatches = existingState === undefined
    ? true
    : useCommunication
      ? existingState.targetClass === core.class.Doc
      : existingState.targetClass === chunter.class.ChatMessage
  console.info('[github-next-service] inbound comment evaluate', {
    issue: issueState.externalNumber,
    issueExternalId: issueState.externalId,
    comment: comment.id,
    externalId,
    targetClass: issueDoc._class,
    targetId: issueDoc._id,
    existingState: existingState?._id,
    existingTargetClass: existingState?.targetClass,
    existingTargetId: existingState?.targetId,
    requestedBackend: backend.requestedBackend,
    communicationEnabled: backend.communicationEnabled,
    useCommunication,
    existingBackendMatches,
    externalHashChanged: existingState?.externalHash !== externalHash,
    authorLogin: comment.authorLogin,
    author
  })

  if (existingState !== undefined && existingState.externalHash === externalHash && existingBackendMatches) {
    console.info('[github-next-service] inbound comment skipped: external hash unchanged', {
      issue: issueState.externalNumber,
      comment: comment.id,
      externalId,
      state: existingState._id,
      backend: useCommunication ? 'communication' : 'chunter',
      targetId: existingState.targetId
    })
    return 'skipped'
  }

  if (existingState === undefined) {
    if (useCommunication) {
      try {
        const messageId = await workspace.communication.createTextComment(
          issueDoc,
          comment.body ?? '',
          (author ?? workspace.client.user) as SocialID,
          createMessageIdForGithubComment(comment),
          Number.isFinite(createdOn) ? new Date(createdOn) : undefined
        )
        putCachedCommunicationComment(cache, messageId !== undefined
          ? {
              id: messageId,
              content: comment.body ?? '',
              created: Number.isFinite(createdOn) ? new Date(createdOn) : new Date(),
              creator: (author ?? workspace.client.user) as SocialID
            }
          : undefined)
        await workspace.client.createDoc(githubNext.class.GithubNextObjectSyncState, core.space.Workspace, withoutUndefined({
          integration: workspace.workspaceIntegration._id,
          provider: workspace.providerContext.provider._id,
          repository: workspace.repositoryDoc._id,
          externalId,
          externalNumber: issueState.externalNumber,
          externalUrl: comment.htmlUrl,
          externalNodeId: comment.nodeId,
          externalVersion: comment.updatedAt,
          externalUpdatedAt: Number.isFinite(modifiedOn) ? modifiedOn : undefined,
          externalHash,
          targetHash: communicationHash,
          targetClass: core.class.Doc,
          targetId: (messageId ?? externalId) as Ref<Doc>,
          lastDirection: 'inbound' as const,
          lastSyncedOn: Date.now()
        }))
        console.info('[github-next-service] inbound comment created communication message', {
          issue: issueState.externalNumber,
          comment: comment.id,
          externalId,
          messageId,
          author,
          createdOn,
          modifiedOn
        })
        return 'created'
      } catch (err) {
        console.warn('[github-next-service] failed to create communication comment, falling back to legacy chunter', {
          issue: issueState.externalNumber,
          externalId,
          err
        })
      }
    }

    const messageId = await workspace.client.addCollection<Doc, ChatMessage>(
      chunter.class.ChatMessage,
      issueDoc.space,
      issueDoc._id,
      issueDoc._class,
      'messages',
      { message: messageMarkup } as AttachedData<ChatMessage>,
      undefined,
      Number.isFinite(createdOn) ? createdOn : undefined,
      author
    )
    await workspace.client.createDoc(githubNext.class.GithubNextObjectSyncState, core.space.Workspace, withoutUndefined({
      integration: workspace.workspaceIntegration._id,
      provider: workspace.providerContext.provider._id,
      repository: workspace.repositoryDoc._id,
      externalId,
      externalNumber: issueState.externalNumber,
      externalUrl: comment.htmlUrl,
      externalNodeId: comment.nodeId,
      externalVersion: comment.updatedAt,
      externalUpdatedAt: Number.isFinite(modifiedOn) ? modifiedOn : undefined,
      externalHash,
      targetHash: messageHash,
      targetClass: chunter.class.ChatMessage,
      targetId: messageId,
      lastDirection: 'inbound' as const,
      lastSyncedOn: Date.now()
    }))
    console.info('[github-next-service] inbound comment created legacy chunter message', {
      issue: issueState.externalNumber,
      comment: comment.id,
      externalId,
      messageId,
      author,
      createdOn,
      modifiedOn
    })
    return 'created'
  }

  if (useCommunication) {
    let message: GithubNextCommunicationComment | undefined
    try {
      message = (await getCachedCommunicationComments(workspace, issueDoc, cache)).find(
        (it) => it.id === existingState.targetId as any
      )
    } catch (err) {
      console.warn('[github-next-service] failed to read communication comments for inbound update', {
        issue: issueState.externalNumber,
        externalId,
        targetId: existingState.targetId,
        err
      })
      return 'skipped'
    }
    if (message === undefined) {
      const messageId = await workspace.communication.createTextComment(
        issueDoc,
        comment.body ?? '',
        (author ?? workspace.client.user) as SocialID,
        createMessageIdForGithubComment(comment),
        Number.isFinite(createdOn) ? new Date(createdOn) : undefined
      )
      putCachedCommunicationComment(cache, messageId !== undefined
        ? {
            id: messageId,
            content: comment.body ?? '',
            created: Number.isFinite(createdOn) ? new Date(createdOn) : new Date(),
            creator: (author ?? workspace.client.user) as SocialID
          }
        : undefined)
      await workspace.client.update(existingState, withoutUndefined({
        externalUrl: comment.htmlUrl,
        externalNodeId: comment.nodeId,
        externalVersion: comment.updatedAt,
        externalUpdatedAt: Number.isFinite(modifiedOn) ? modifiedOn : undefined,
        externalHash,
        targetHash: communicationHash,
        targetClass: core.class.Doc,
        targetId: (messageId ?? externalId) as Ref<Doc>,
        lastDirection: 'inbound' as const,
        lastSyncedOn: Date.now()
      }))
      console.info('[github-next-service] inbound comment restored missing communication message', {
        issue: issueState.externalNumber,
        comment: comment.id,
        externalId,
        state: existingState._id,
        oldTargetId: existingState.targetId,
        newTargetId: messageId
      })
      return 'updated'
    }

    const currentHash = stableHash({ content: message.content })
    if (currentHash !== existingState.targetHash) {
      console.info('[github-next-service] inbound comment skipped: local communication comment changed', {
        issue: issueState.externalNumber,
        comment: comment.id,
        externalId,
        state: existingState._id,
        messageId: message.id
      })
      return 'skipped'
    }

    await workspace.communication.updateTextComment(
      issueDoc,
      existingState.targetId as any as MessageID,
      comment.body ?? '',
      (author ?? workspace.client.user) as SocialID,
      Number.isFinite(modifiedOn) ? new Date(modifiedOn) : undefined
    )
    putCachedCommunicationComment(cache, {
      ...message,
      content: comment.body ?? ''
    })
    await workspace.client.update(existingState, withoutUndefined({
      externalUrl: comment.htmlUrl,
      externalNodeId: comment.nodeId,
      externalVersion: comment.updatedAt,
      externalUpdatedAt: Number.isFinite(modifiedOn) ? modifiedOn : undefined,
      externalHash,
      targetHash: communicationHash,
      lastDirection: 'inbound' as const,
      lastSyncedOn: Date.now()
    }))
    console.info('[github-next-service] inbound comment updated communication message', {
      issue: issueState.externalNumber,
      comment: comment.id,
      externalId,
      state: existingState._id,
      messageId: existingState.targetId,
      modifiedOn
    })
    return 'updated'
  }

  const message = await workspace.client.findOne<ChatMessage>(
    chunter.class.ChatMessage,
    { _id: existingState.targetId as Ref<ChatMessage> }
  )
  if (message === undefined) {
    const messageId = await workspace.client.addCollection<Doc, ChatMessage>(
      chunter.class.ChatMessage,
      issueDoc.space,
      issueDoc._id,
      issueDoc._class,
      'messages',
      { message: messageMarkup } as AttachedData<ChatMessage>,
      undefined,
      Number.isFinite(createdOn) ? createdOn : undefined,
      author
    )
    await workspace.client.update(existingState, withoutUndefined({
      externalUrl: comment.htmlUrl,
      externalNodeId: comment.nodeId,
      externalVersion: comment.updatedAt,
      externalUpdatedAt: Number.isFinite(modifiedOn) ? modifiedOn : undefined,
      externalHash,
      targetHash: messageHash,
      targetClass: chunter.class.ChatMessage,
      targetId: messageId,
      lastDirection: 'inbound' as const,
      lastSyncedOn: Date.now()
    }))
    console.info('[github-next-service] inbound comment restored missing legacy chunter message', {
      issue: issueState.externalNumber,
      comment: comment.id,
      externalId,
      state: existingState._id,
      oldTargetId: existingState.targetId,
      newTargetId: messageId
    })
    return 'updated'
  }
  const currentHash = stableHash({ message: message.message })
  if (currentHash !== existingState.targetHash) {
    console.info('[github-next-service] inbound comment skipped: local legacy chunter comment changed', {
      issue: issueState.externalNumber,
      comment: comment.id,
      externalId,
      state: existingState._id,
      messageId: message._id
    })
    return 'skipped'
  }

  await workspace.client.update(message, { message: messageMarkup, editedOn: Number.isFinite(modifiedOn) ? modifiedOn : Date.now() })
  await workspace.client.update(existingState, withoutUndefined({
    externalUrl: comment.htmlUrl,
    externalNodeId: comment.nodeId,
    externalVersion: comment.updatedAt,
    externalUpdatedAt: Number.isFinite(modifiedOn) ? modifiedOn : undefined,
    externalHash,
    targetHash: messageHash,
    lastDirection: 'inbound' as const,
    lastSyncedOn: Date.now()
  }))
  console.info('[github-next-service] inbound comment updated legacy chunter message', {
    issue: issueState.externalNumber,
    comment: comment.id,
    externalId,
    state: existingState._id,
    messageId: message._id,
    modifiedOn
  })
  return 'updated'
}

async function deleteLocalSyncedIssueComment (
  workspace: WorkspaceContext,
  issueDoc: Doc,
  state: GithubNextObjectSyncState
): Promise<boolean> {
  const backend = await resolveCommentBackend(
    workspace.client,
    workspace.workspaceIntegration,
    workspace.providerContext,
    issueDoc
  )
  const useCommunication = backend.useCommunication && state.targetClass === core.class.Doc
  console.info('[github-next-service] inbound comment delete evaluate', {
    targetClass: issueDoc._class,
    targetId: issueDoc._id,
    state: state._id,
    stateTargetClass: state.targetClass,
    stateTargetId: state.targetId,
    requestedBackend: backend.requestedBackend,
    communicationEnabled: backend.communicationEnabled,
    useCommunication
  })

  if (useCommunication) {
    await workspace.communication.removeTextComment(
      issueDoc,
      state.targetId as any as MessageID,
      workspace.client.user as SocialID
    )
    await workspace.client.removeDoc(state._class, state.space, state._id)
    return true
  }

  const message = await workspace.client.findOne<ChatMessage>(
    chunter.class.ChatMessage,
    { _id: state.targetId as Ref<ChatMessage> }
  )
  if (message !== undefined) {
    await workspace.client.removeCollection(
      message._class,
      message.space,
      message._id,
      message.attachedTo,
      message.attachedToClass,
      message.collection
    )
  }
  await workspace.client.removeDoc(state._class, state.space, state._id)
  return true
}

async function syncInboundIssueComments (
  ctx: MeasureContext,
  workspace: WorkspaceContext,
  token: string,
  githubContext: GithubRequestContext,
  issue: GithubNextIssue
): Promise<void> {
  const issueState = await workspace.client.findOne(githubNext.class.GithubNextObjectSyncState, {
    integration: workspace.workspaceIntegration._id,
    provider: workspace.providerContext.provider._id,
    repository: workspace.repositoryDoc._id,
    externalId: String(issue.id)
  })
  if (issueState === undefined) {
    console.info('[github-next-service] inbound comments skipped: issue state not found', {
      issue: issue.number,
      issueExternalId: issue.id,
      repository: getRepositoryKey(issue.repository)
    })
    return
  }

  const issueDoc = await workspace.client.findOne(issueState.targetClass, { _id: issueState.targetId })
  if (issueDoc === undefined) {
    console.info('[github-next-service] inbound comments skipped: issue target doc not found', {
      issue: issue.number,
      issueExternalId: issue.id,
      state: issueState._id,
      targetClass: issueState.targetClass,
      targetId: issueState.targetId
    })
    return
  }

  const comments = (await listGithubIssueComments(token, issue.repository, issue.number)).sort(compareGithubIssueComments)
  console.info('[github-next-service] inbound comments fetched', {
    issue: issue.number,
    issueExternalId: issue.id,
    state: issueState._id,
    targetClass: issueDoc._class,
    targetId: issueDoc._id,
    repository: getRepositoryKey(issue.repository),
    comments: comments.length
  })
  const cache: GithubNextCommentSyncCache = {}
  const currentExternalIds = new Set(comments.map((comment) => getIssueCommentExternalId(issueState.externalId, comment.id)))
  for (const comment of comments) {
    const result = await upsertInboundIssueComment(workspace, issueState, issueDoc, comment, token, githubContext, cache)
    if (result !== 'skipped') {
      ctx.info('GitHub Next issue comment inbound sync', {
        result,
        issue: issue.number,
        comment: comment.id,
        targetId: issueDoc._id
      })
    }
  }

  const syncedCommentStates = await workspace.client.findAll(githubNext.class.GithubNextObjectSyncState, {
    integration: workspace.workspaceIntegration._id,
    provider: workspace.providerContext.provider._id,
    repository: workspace.repositoryDoc._id
  })
  for (const state of syncedCommentStates.filter((state) => state.externalId.startsWith(`issue:${issueState.externalId}:comment:`))) {
    if (currentExternalIds.has(state.externalId)) continue

    if (await deleteLocalSyncedIssueComment(workspace, issueDoc, state)) {
      ctx.info('GitHub Next issue comment inbound delete sync', {
        issue: issue.number,
        externalId: state.externalId,
        targetId: state.targetId
      })
    }
  }
}

async function syncInboundIssues (
  ctx: MeasureContext,
  accountsUrl: string,
  workspaceUuid: WorkspaceUuid
): Promise<SyncGithubNextWorkspaceResult> {
  const serviceToken = generateToken(systemAccountUuid, workspaceUuid, { service: 'github-next' })
  const accountClient = getAccountClient(accountsUrl, serviceToken)
  const accountIntegrations = await accountClient.listIntegrations({
    kind: githubNextIntegrationKind,
    workspaceUuid
  })

  const result: SyncGithubNextWorkspaceResult = {
    integrations: accountIntegrations.length,
    repositories: 0,
    issuesSeen: 0,
    discussionsSeen: 0,
    created: 0,
    updated: 0,
    skipped: 0
  }
  if (accountIntegrations.length === 0) return result

  const { client, markup, communication } = await createWorkspaceClient(accountsUrl, workspaceUuid)
  const githubContext = createGithubRequestContext()
  try {
    const workspaceIntegration = await getWorkspaceIntegration(client)
    if (workspaceIntegration === undefined) return result

    const issueProvider = await getProviderContext(client, workspaceIntegration, githubNext.ids.GithubNextIssueProvider)
    if (issueProvider === undefined) return result

    for (const accountIntegration of accountIntegrations) {
      const integrationData = accountIntegration.data as GithubNextIntegrationData | undefined
      const repositories = integrationData?.repositories ?? []
      if (!integrationData?.capabilities?.issues || repositories.length === 0) continue

      const secret = await getTokenSecret(accountsUrl, accountIntegration)
      if (secret == null || secret.secret.trim() === '') continue

      const repositoryDocs = await ensureRepositoryDocs(ctx, client, workspaceIntegration, repositories)
      result.repositories += repositories.length

      for (const repository of repositories) {
        const repositoryDoc = repositoryDocs.get(`${repository.owner}/${repository.name}`)
        if (repositoryDoc === undefined || !repositoryDoc.enabled) continue

        const issues = await listGithubIssues(secret.secret, repository, githubContext)
        result.issuesSeen += issues.length

        for (const issue of issues) {
          const syncResult = await upsertInboundObject(
            ctx,
            {
              client,
              markup,
              communication,
              workspaceIntegration,
              repositoryDoc,
              providerContext: issueProvider
            },
            await normalizeIssueSlots(client, issue),
            {
              externalId: String(issue.id),
              externalNumber: issue.number,
              externalUrl: issue.htmlUrl,
              externalNodeId: issue.nodeId,
              externalVersion: issue.updatedAt
            }
          )
          result[syncResult]++
          await syncInboundIssueComments(
            ctx,
            {
              client,
              markup,
              communication,
              workspaceIntegration,
              repositoryDoc,
              providerContext: issueProvider
            },
            secret.secret,
            githubContext,
            issue
          )
        }
      }
    }
  } finally {
    await client.close()
  }

  return result
}

async function syncInboundDiscussions (
  ctx: MeasureContext,
  accountsUrl: string,
  workspaceUuid: WorkspaceUuid
): Promise<SyncGithubNextWorkspaceResult> {
  const serviceToken = generateToken(systemAccountUuid, workspaceUuid, { service: 'github-next' })
  const accountClient = getAccountClient(accountsUrl, serviceToken)
  const accountIntegrations = await accountClient.listIntegrations({
    kind: githubNextIntegrationKind,
    workspaceUuid
  })

  const result: SyncGithubNextWorkspaceResult = {
    integrations: accountIntegrations.length,
    repositories: 0,
    issuesSeen: 0,
    discussionsSeen: 0,
    created: 0,
    updated: 0,
    skipped: 0
  }
  if (accountIntegrations.length === 0) return result

  const { client, markup, communication } = await createWorkspaceClient(accountsUrl, workspaceUuid)
  try {
    const workspaceIntegration = await getWorkspaceIntegration(client)
    if (workspaceIntegration === undefined) return result

    const discussionProvider = await getProviderContext(
      client,
      workspaceIntegration,
      githubNext.ids.GithubNextDiscussionProvider
    )
    if (discussionProvider === undefined) return result

    for (const accountIntegration of accountIntegrations) {
      const integrationData = accountIntegration.data as GithubNextIntegrationData | undefined
      const repositories = integrationData?.repositories ?? []
      if (!integrationData?.capabilities?.discussions || repositories.length === 0) continue

      const secret = await getTokenSecret(accountsUrl, accountIntegration)
      if (secret == null || secret.secret.trim() === '') continue

      const repositoryDocs = await ensureRepositoryDocs(ctx, client, workspaceIntegration, repositories)
      result.repositories += repositories.length

      for (const repository of repositories) {
        const repositoryDoc = repositoryDocs.get(`${repository.owner}/${repository.name}`)
        if (repositoryDoc === undefined || !repositoryDoc.enabled) continue

        const discussions = await listGithubDiscussions(secret.secret, repository)
        result.discussionsSeen += discussions.length

        for (const discussion of discussions) {
          const syncResult = await upsertInboundObject(
            ctx,
            {
              client,
              markup,
              communication,
              workspaceIntegration,
              repositoryDoc,
              providerContext: discussionProvider
            },
            normalizeDiscussionSlots(discussion),
            {
              externalId: discussion.id,
              externalNumber: discussion.number,
              externalUrl: discussion.htmlUrl,
              externalVersion: discussion.updatedAt
            }
          )
          result[syncResult]++
        }
      }
    }
  } finally {
    await client.close()
  }

  return result
}

async function buildIssuePatch (
  client: TxOperations,
  markup: MarkupOperations,
  doc: Doc,
  binding: IntegrationSlotBinding,
  token?: string,
  githubContext?: GithubRequestContext,
  outboundState?: {
    state: GithubNextObjectSyncState
    externalMappedValues: Record<string, unknown>
    localModifiedOn: number
  }
): Promise<{
  title?: string
  body?: string
  state?: 'open' | 'closed'
  assignees?: string[]
  labels?: string[]
  targetHash: string
}> {
  const markdownTargetValues = await fetchMappedTargetValues(client, markup, doc, binding, 'markdown')
  const currentTargetValues = await fetchMappedTargetValues(client, markup, doc, binding, 'markup')
  const reversed = applyIntegrationSlotReverseBinding(markdownTargetValues, binding) as Record<string, unknown>
  const assigneeAttr = binding.bindings.assignee
  const labelsAttr = binding.bindings.labels
  const assignee = assigneeAttr !== undefined ? (doc as Record<string, any>)[assigneeAttr] : undefined

  const assigneeLogin =
    assigneeAttr !== undefined ? await resolvePersonToGithubLogin(client, token, assignee ?? null, githubContext) : undefined
  const labelTitles =
    labelsAttr !== undefined ? ((await getDocLabelTitles(client, doc, labelsAttr)) ?? []) : undefined
  let assignees: string[] | undefined
  if (assigneeAttr !== undefined && assignee == null) {
    assignees = []
  } else if (assigneeLogin !== undefined) {
    assignees = [assigneeLogin]
  }

  const fullPatch: {
    title?: string
    body?: string
    state?: 'open' | 'closed'
    assignees?: string[]
    labels?: string[]
  } = {
    title: typeof reversed.title === 'string' ? reversed.title : undefined,
    body: typeof reversed.description === 'string' ? reversed.description : undefined,
    state: reversed.state === 'open' || reversed.state === 'closed' ? reversed.state : undefined,
    assignees,
    labels: labelTitles
  }
  const patch = outboundState === undefined
    ? fullPatch
    : getOutboundWinningIssuePatch(
      binding,
      fullPatch,
      currentTargetValues,
      outboundState.externalMappedValues,
      outboundState.state,
      outboundState.localModifiedOn
    )

  return {
    ...patch,
    targetHash: await getTargetHash(client, markup, doc, binding)
  }
}

function normalizeComparableValue (value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value].sort((left, right) => String(left).localeCompare(String(right)))
  }

  return value
}

async function buildDiscussionPatch (
  client: TxOperations,
  markup: MarkupOperations,
  repository: GithubNextRepository,
  token: string,
  doc: Doc,
  binding: IntegrationSlotBinding,
  outboundState?: {
    state: GithubNextObjectSyncState
    externalMappedValues: Record<string, unknown>
    localModifiedOn: number
  }
): Promise<{
  title?: string
  body?: string
  categoryId?: string
  targetHash: string
}> {
  const markdownTargetValues = await fetchMappedTargetValues(client, markup, doc, binding, 'markdown')
  const reversed = applyIntegrationSlotReverseBinding(markdownTargetValues, binding) as Record<string, unknown>
  const categoryName = typeof reversed.category === 'string' ? reversed.category : undefined
  let categoryId: string | undefined

  if (categoryName !== undefined) {
    const categories = await listGithubDiscussionCategories(token, {
      owner: repository.owner,
      name: repository.name
    })
    categoryId = categories.find((category) => category.name === categoryName)?.id
  }

  const fullPatch = {
    title: typeof reversed.title === 'string' ? reversed.title : undefined,
    body: typeof reversed.description === 'string' ? reversed.description : undefined,
    categoryId
  }
  const currentTargetValues = await fetchMappedTargetValues(client, markup, doc, binding, 'markup')
  const patch = outboundState === undefined
    ? fullPatch
    : getOutboundWinningDiscussionPatch(
      binding,
      fullPatch,
      currentTargetValues,
      outboundState.externalMappedValues,
      outboundState.state,
      outboundState.localModifiedOn
    )

  return {
    ...patch,
    targetHash: stableHash(currentTargetValues)
  }
}

async function createOutboundIssue (
  client: TxOperations,
  markup: GithubNextMarkupOperations,
  workspaceIntegration: WorkspaceIntegration,
  providerContext: ProviderContext,
  token: string,
  githubContext: GithubRequestContext,
  route: OutboundRoute,
  doc: Doc
): Promise<void> {
  const draft = await buildIssuePatch(client, markup, doc, providerContext.binding, token, githubContext)
  if (draft.title === undefined || draft.title.trim() === '') {
    throw new Error(`Cannot create GitHub issue from ${doc._id}: title is required`)
  }

  const created = await createGithubIssue(
    token,
    route.repository,
    {
      title: draft.title,
      body: draft.body,
      assignees: draft.assignees,
      labels: draft.labels
    },
    githubContext
  )
  const externalValues = applyIntegrationSlotBinding(await normalizeIssueSlots(client, created), providerContext.binding)
  const targetValues = await fetchMappedTargetValues(client, markup, doc, providerContext.binding, 'markup')

  await client.createDoc(githubNext.class.GithubNextObjectSyncState, core.space.Workspace, withoutUndefined({
    integration: workspaceIntegration._id,
    provider: providerContext.provider._id,
    repository: route.repository._id,
    externalId: String(created.id),
    externalNumber: created.number,
    externalUrl: created.htmlUrl,
    externalNodeId: created.nodeId,
    externalVersion: created.updatedAt,
    externalUpdatedAt: Date.parse(created.updatedAt),
    externalHash: stableHash(externalValues),
    externalValues,
    targetHash: stableHash(targetValues),
    targetValues,
    targetClass: doc._class,
    targetId: doc._id,
    lastDirection: 'outbound' as const,
    lastSyncedOn: Date.now()
  }))
}

async function createOutboundDiscussion (
  client: TxOperations,
  markup: GithubNextMarkupOperations,
  workspaceIntegration: WorkspaceIntegration,
  providerContext: ProviderContext,
  token: string,
  route: OutboundRoute,
  doc: Doc
): Promise<void> {
  const draft = await buildDiscussionPatch(client, markup, route.repository, token, doc, providerContext.binding)
  if (draft.title === undefined || draft.title.trim() === '') {
    throw new Error(`Cannot create GitHub discussion from ${doc._id}: title is required`)
  }
  if (draft.categoryId === undefined || draft.categoryId.trim() === '') {
    throw new Error(`Cannot create GitHub discussion from ${doc._id}: category is required`)
  }

  const created = await createGithubDiscussion(token, route.repository, {
    title: draft.title,
    body: draft.body,
    categoryId: draft.categoryId
  })
  const externalValues = applyIntegrationSlotBinding(normalizeDiscussionSlots(created), providerContext.binding)
  const targetValues = await fetchMappedTargetValues(client, markup, doc, providerContext.binding, 'markup')

  await client.createDoc(githubNext.class.GithubNextObjectSyncState, core.space.Workspace, withoutUndefined({
    integration: workspaceIntegration._id,
    provider: providerContext.provider._id,
    repository: route.repository._id,
    externalId: created.id,
    externalNumber: created.number,
    externalUrl: created.htmlUrl,
    externalVersion: created.updatedAt,
    externalUpdatedAt: Date.parse(created.updatedAt),
    externalHash: stableHash(externalValues),
    externalValues,
    targetHash: stableHash(targetValues),
    targetValues,
    targetClass: doc._class,
    targetId: doc._id,
    lastDirection: 'outbound' as const,
    lastSyncedOn: Date.now()
  }))
}

async function syncOutboundCreatesForProvider (
  ctx: MeasureContext,
  client: TxOperations,
  markup: GithubNextMarkupOperations,
  workspaceIntegration: WorkspaceIntegration,
  providerContext: ProviderContext,
  token: string,
  githubContext: GithubRequestContext,
  routes: OutboundRoute[],
  kind: SyncKind
): Promise<{ created: number, skipped: number }> {
  const syncedTargetKeys = await getSyncedTargetKeys(client, workspaceIntegration, providerContext.provider)
  const result = { created: 0, skipped: 0 }

  for (const route of routes) {
    const docs = await findOutboundTargetDocs(client, route, syncedTargetKeys)
    for (const doc of docs) {
      try {
        if (kind === 'issue') {
          await createOutboundIssue(client, markup, workspaceIntegration, providerContext, token, githubContext, route, doc)
        } else {
          await createOutboundDiscussion(client, markup, workspaceIntegration, providerContext, token, route, doc)
        }
        syncedTargetKeys.add(doc._id)
        syncedTargetKeys.add(`${doc._class}:${doc._id}`)
        result.created++
      } catch (err) {
        ctx.warn('Skipping GitHub Next outbound create', {
          kind,
          repository: getRepositoryKey(route.repository),
          targetClass: doc._class,
          targetId: doc._id,
          err
        })
        result.skipped++
      }
    }
  }

  return result
}

async function syncOutboundIssueComments (
  ctx: MeasureContext,
  client: TxOperations,
  communication: GithubNextCommunicationOperations,
  repository: GithubNextRepository,
  workspaceIntegration: WorkspaceIntegration,
  providerContext: ProviderContext,
  token: string,
  issueState: GithubNextObjectSyncState,
  issueDoc: Doc
): Promise<{ created: number, updated: number, skipped: number }> {
  if (issueState.externalNumber === undefined) return { created: 0, updated: 0, skipped: 1 }

  const states = await client.findAll(githubNext.class.GithubNextObjectSyncState, {
    integration: workspaceIntegration._id,
    provider: providerContext.provider._id,
    repository: repository._id
  })
  const issueCommentExternalIdPrefix = `issue:${issueState.externalId}:comment:`
  const commentStates = states.filter((state) => state.externalId.startsWith(issueCommentExternalIdPrefix))
  const communicationCommentStates = commentStates.filter((state) => state.targetClass === core.class.Doc)
  const legacyCommentStates = commentStates.filter((state) => state.targetClass !== core.class.Doc)
  const backend = await resolveCommentBackend(client, workspaceIntegration, providerContext, issueDoc)
  const useCommunication = backend.useCommunication
  console.info('[github-next-service] outbound comments evaluate', {
    issue: issueState.externalNumber,
    issueExternalId: issueState.externalId,
    targetClass: issueDoc._class,
    targetId: issueDoc._id,
    repository: getRepositoryKey(repository),
    requestedBackend: backend.requestedBackend,
    communicationEnabled: backend.communicationEnabled,
    useCommunication,
    commentStates: commentStates.length,
    communicationCommentStates: communicationCommentStates.length,
    legacyCommentStates: legacyCommentStates.length
  })
  if (useCommunication) {
    let messages: GithubNextCommunicationComment[] | undefined
    try {
      messages = await communication.findTextComments(issueDoc)
    } catch (err) {
      console.warn('[github-next-service] failed to read communication comments, falling back to legacy chunter', {
        targetClass: issueDoc._class,
        targetId: issueDoc._id,
        issue: issueState.externalNumber,
        err
      })
    }
    if (messages !== undefined) {
      const messagesById = new Map(messages.map((message) => [message.id, message]))
      const syncedMessageIds: Set<string> = new Set(
        communicationCommentStates.map((state) => state.targetId)
      )
      const result = { created: 0, updated: 0, skipped: 0 }

      console.info('[github-next-service] syncing communication comments', {
        targetClass: issueDoc._class,
        targetId: issueDoc._id,
        requestedBackend: backend.requestedBackend,
        messages: messages.length
      })

      for (const state of communicationCommentStates) {
        const commentId = getIssueCommentIdFromExternalId(state.externalId)
        if (commentId === undefined) {
          console.info('[github-next-service] outbound communication comment skipped: invalid external id', {
            issue: issueState.externalNumber,
            externalId: state.externalId,
            state: state._id
          })
          result.skipped++
          continue
        }

        const message = messagesById.get(state.targetId as any as MessageID)
        if (message === undefined || message.content.trim() === '') {
          console.info('[github-next-service] outbound communication comment deleting GitHub comment: local missing or empty', {
            issue: issueState.externalNumber,
            externalId: state.externalId,
            comment: commentId,
            state: state._id,
            targetId: state.targetId,
            messageFound: message !== undefined,
            empty: message?.content.trim() === ''
          })
          await deleteGithubIssueComment(token, { owner: repository.owner, name: repository.name }, commentId)
          await client.removeDoc(state._class, state.space, state._id)
          result.updated++
          continue
        }

        const targetHash = stableHash({ content: message.content })
        if (targetHash === state.targetHash) {
          console.info('[github-next-service] outbound communication comment skipped: target hash unchanged', {
            issue: issueState.externalNumber,
            externalId: state.externalId,
            comment: commentId,
            state: state._id,
            messageId: message.id
          })
          result.skipped++
          continue
        }

        console.info('[github-next-service] outbound communication comment updating GitHub', {
          issue: issueState.externalNumber,
          externalId: state.externalId,
          comment: commentId,
          state: state._id,
          messageId: message.id
        })
        const updated = await updateGithubIssueComment(
          token,
          { owner: repository.owner, name: repository.name },
          commentId,
          message.content
        )
        await client.update(state, {
          externalUrl: updated.htmlUrl,
          externalNodeId: updated.nodeId,
          externalVersion: updated.updatedAt,
          externalUpdatedAt: Date.parse(updated.updatedAt),
          externalHash: stableHash(normalizeIssueComment(updated)),
          targetHash,
          lastDirection: 'outbound',
          lastSyncedOn: Date.now()
        })
        result.updated++
      }

      for (const message of messages) {
        if (syncedMessageIds.has(message.id)) {
          console.info('[github-next-service] outbound communication comment skipped: already synced', {
            issue: issueState.externalNumber,
            messageId: message.id
          })
          result.skipped++
          continue
        }

        const body = message.content.trim()
        if (body === '') {
          console.info('[github-next-service] outbound communication comment skipped: empty local message', {
            issue: issueState.externalNumber,
            messageId: message.id
          })
          result.skipped++
          continue
        }

        console.info('[github-next-service] outbound communication comment creating GitHub comment', {
          issue: issueState.externalNumber,
          messageId: message.id,
          created: message.created,
          creator: message.creator
        })
        const created = await createGithubIssueComment(
          token,
          { owner: repository.owner, name: repository.name },
          issueState.externalNumber,
          body
        )
        const externalId = getIssueCommentExternalId(issueState.externalId, created.id)
        const externalHash = stableHash(normalizeIssueComment(created))
        const targetHash = stableHash({ content: message.content })
        await client.createDoc(githubNext.class.GithubNextObjectSyncState, core.space.Workspace, withoutUndefined({
          integration: workspaceIntegration._id,
          provider: providerContext.provider._id,
          repository: repository._id,
          externalId,
          externalNumber: issueState.externalNumber,
          externalUrl: created.htmlUrl,
          externalNodeId: created.nodeId,
          externalVersion: created.updatedAt,
          externalUpdatedAt: Date.parse(created.updatedAt),
          externalHash,
          targetHash,
          targetClass: core.class.Doc,
          targetId: message.id,
          lastDirection: 'outbound' as const,
          lastSyncedOn: Date.now()
        }))
        syncedMessageIds.add(message.id)
        result.created++
        ctx.info('GitHub Next issue communication comment outbound sync', {
          issue: issueState.externalNumber,
          comment: created.id,
          targetId: message.id
        })
      }

      return result
    }
  }

  const messages = await client.findAll<ChatMessage>(chunter.class.ChatMessage, {
    attachedTo: issueDoc._id,
    attachedToClass: issueDoc._class,
    collection: 'messages'
  })
  const messagesById = new Map(messages.map((message) => [message._id, message]))
  const syncedMessageIds: Set<string> = new Set(
    legacyCommentStates.map((state) => state.targetId)
  )
  const result = { created: 0, updated: 0, skipped: 0 }

  console.info('[github-next-service] syncing legacy chunter comments', {
    targetClass: issueDoc._class,
    targetId: issueDoc._id,
    requestedBackend: backend.requestedBackend,
    communicationEnabled: backend.communicationEnabled
  })

  for (const state of legacyCommentStates) {
    const commentId = getIssueCommentIdFromExternalId(state.externalId)
    if (commentId === undefined) {
      console.info('[github-next-service] outbound legacy comment skipped: invalid external id', {
        issue: issueState.externalNumber,
        externalId: state.externalId,
        state: state._id
      })
      result.skipped++
      continue
    }

    const message = messagesById.get(state.targetId as Ref<ChatMessage>)
    if (message === undefined) {
      console.info('[github-next-service] outbound legacy comment deleting GitHub comment: local missing', {
        issue: issueState.externalNumber,
        externalId: state.externalId,
        comment: commentId,
        state: state._id,
        targetId: state.targetId
      })
      await deleteGithubIssueComment(token, { owner: repository.owner, name: repository.name }, commentId)
      await client.removeDoc(state._class, state.space, state._id)
      result.updated++
      continue
    }

    const body = markupToMarkdown(markupToJSON(message.message), { refUrl: '', imageUrl: '' })
    if (body.trim() === '') {
      console.info('[github-next-service] outbound legacy comment deleting GitHub comment: local empty', {
        issue: issueState.externalNumber,
        externalId: state.externalId,
        comment: commentId,
        state: state._id,
        messageId: message._id
      })
      await deleteGithubIssueComment(token, { owner: repository.owner, name: repository.name }, commentId)
      await client.removeDoc(state._class, state.space, state._id)
      result.updated++
      continue
    }

    const targetHash = stableHash({ message: message.message })
    if (targetHash === state.targetHash) {
      console.info('[github-next-service] outbound legacy comment skipped: target hash unchanged', {
        issue: issueState.externalNumber,
        externalId: state.externalId,
        comment: commentId,
        state: state._id,
        messageId: message._id
      })
      result.skipped++
      continue
    }

    console.info('[github-next-service] outbound legacy comment updating GitHub', {
      issue: issueState.externalNumber,
      externalId: state.externalId,
      comment: commentId,
      state: state._id,
      messageId: message._id
    })
    const updated = await updateGithubIssueComment(
      token,
      { owner: repository.owner, name: repository.name },
      commentId,
      body
    )
    await client.update(state, {
      externalUrl: updated.htmlUrl,
      externalNodeId: updated.nodeId,
      externalVersion: updated.updatedAt,
      externalUpdatedAt: Date.parse(updated.updatedAt),
      externalHash: stableHash(normalizeIssueComment(updated)),
      targetHash,
      lastDirection: 'outbound',
      lastSyncedOn: Date.now()
    })
    result.updated++
  }

  for (const message of messages.sort(compareChatMessages)) {
    if (syncedMessageIds.has(message._id)) {
      console.info('[github-next-service] outbound legacy comment skipped: already synced', {
        issue: issueState.externalNumber,
        messageId: message._id
      })
      result.skipped++
      continue
    }

    const body = markupToMarkdown(markupToJSON(message.message), { refUrl: '', imageUrl: '' })
    if (body.trim() === '') {
      console.info('[github-next-service] outbound legacy comment skipped: empty local message', {
        issue: issueState.externalNumber,
        messageId: message._id
      })
      result.skipped++
      continue
    }

    console.info('[github-next-service] outbound legacy comment creating GitHub comment', {
      issue: issueState.externalNumber,
      messageId: message._id,
      createdOn: message.createdOn,
      createdBy: message.createdBy
    })
    const created = await createGithubIssueComment(
      token,
      { owner: repository.owner, name: repository.name },
      issueState.externalNumber,
      body
    )
    const externalId = getIssueCommentExternalId(issueState.externalId, created.id)
    const externalHash = stableHash(normalizeIssueComment(created))
    const targetHash = stableHash({ message: message.message })
    await client.createDoc(githubNext.class.GithubNextObjectSyncState, core.space.Workspace, withoutUndefined({
      integration: workspaceIntegration._id,
      provider: providerContext.provider._id,
      repository: repository._id,
      externalId,
      externalNumber: issueState.externalNumber,
      externalUrl: created.htmlUrl,
      externalNodeId: created.nodeId,
      externalVersion: created.updatedAt,
      externalUpdatedAt: Date.parse(created.updatedAt),
      externalHash,
      targetHash,
      targetClass: message._class,
      targetId: message._id,
      lastDirection: 'outbound' as const,
      lastSyncedOn: Date.now()
    }))
    syncedMessageIds.add(message._id)
    result.created++
    ctx.info('GitHub Next issue comment outbound sync', {
      issue: issueState.externalNumber,
      comment: created.id,
      targetId: message._id
    })
  }

  return result
}

async function syncOutboundForProvider (
  ctx: MeasureContext,
  accountsUrl: string,
  workspaceUuid: WorkspaceUuid,
  kind: SyncKind
): Promise<SyncGithubNextWorkspaceResult> {
  const serviceToken = generateToken(systemAccountUuid, workspaceUuid, { service: 'github-next' })
  const accountClient = getAccountClient(accountsUrl, serviceToken)
  const accountIntegrations = await accountClient.listIntegrations({
    kind: githubNextIntegrationKind,
    workspaceUuid
  })

  const result: SyncGithubNextWorkspaceResult = {
    integrations: accountIntegrations.length,
    repositories: 0,
    issuesSeen: 0,
    discussionsSeen: 0,
    created: 0,
    updated: 0,
    skipped: 0
  }
  if (accountIntegrations.length === 0) return result

  const { client, markup, communication } = await createWorkspaceClient(accountsUrl, workspaceUuid)
  const githubContext = createGithubRequestContext()
  try {
    const workspaceIntegration = await getWorkspaceIntegration(client)
    if (workspaceIntegration === undefined) return result

    const providerId = kind === 'issue' ? githubNext.ids.GithubNextIssueProvider : githubNext.ids.GithubNextDiscussionProvider
    const providerContext = await getProviderContext(client, workspaceIntegration, providerId)
    if (providerContext === undefined) return result

    for (const accountIntegration of accountIntegrations) {
      const integrationData = accountIntegration.data as GithubNextIntegrationData | undefined
      const repositories = integrationData?.repositories ?? []
      const capabilityEnabled = kind === 'issue' ? integrationData?.capabilities?.issues : integrationData?.capabilities?.discussions
      if (!capabilityEnabled || repositories.length === 0) continue

      const secret = await getTokenSecret(accountsUrl, accountIntegration)
      if (secret == null || secret.secret.trim() === '') continue

      const repositoryDocs = await ensureRepositoryDocs(ctx, client, workspaceIntegration, repositories)
      const routes = await getOutboundRoutes(ctx, providerContext, repositoryDocs.values())
      result.repositories += routes.length

      const createResult = await syncOutboundCreatesForProvider(
        ctx,
        client,
        markup,
        workspaceIntegration,
        providerContext,
        secret.secret,
        githubContext,
        routes,
        kind
      )
      result.created += createResult.created
      result.skipped += createResult.skipped

      const states = await client.findAll(githubNext.class.GithubNextObjectSyncState, {
        integration: workspaceIntegration._id,
        provider: providerContext.provider._id
      })

      for (const state of states) {
        if (isIssueCommentExternalId(state.externalId)) {
          result.skipped++
          continue
        }

        const repository = await client.findOne(githubNext.class.GithubNextRepository, { _id: state.repository })
        if (repository === undefined || !repository.enabled) continue

        const targetDoc = await client.findOne(state.targetClass, { _id: state.targetId })
        if (targetDoc === undefined) {
          result.skipped++
          continue
        }
        if (!client.getHierarchy().isDerived(targetDoc._class, providerContext.binding.targetClass)) {
          result.skipped++
          continue
        }

        if (kind === 'issue') {
          result.issuesSeen++
          const commentsResult = await syncOutboundIssueComments(
            ctx,
            client,
            communication,
            repository,
            workspaceIntegration,
            providerContext,
            secret.secret,
            state,
            targetDoc
          )
          result.created += commentsResult.created
          result.updated += commentsResult.updated
          result.skipped += commentsResult.skipped

          let outboundTargetDoc = targetDoc
          const currentTargetValues = await fetchMappedTargetValues(client, markup, outboundTargetDoc, providerContext.binding, 'markup')
          const currentTargetHash = stableHash(currentTargetValues)
          if (currentTargetHash === state.targetHash) {
            result.skipped++
            continue
          }
          if (state.externalNumber === undefined) {
            result.skipped++
            continue
          }
          const externalIssue = await getGithubIssue(
            secret.secret,
            { owner: repository.owner, name: repository.name },
            state.externalNumber,
            githubContext
          )
          const externalMappedValues = applyIntegrationSlotBinding(
            await normalizeIssueSlots(client, externalIssue),
            providerContext.binding
          )
          const localModifiedOn = getObjectModifiedOn(outboundTargetDoc)
          const externalWinningValues = getOutboundExternalWinningTargetValues(
            providerContext.binding,
            currentTargetValues,
            externalMappedValues,
            state,
            localModifiedOn
          )
          if (Object.keys(externalWinningValues).length > 0) {
            ctx.info('GitHub Next outbound pre-applies external winning fields', {
              state: state._id,
              targetClass: outboundTargetDoc._class,
              targetId: outboundTargetDoc._id,
              externalNumber: state.externalNumber,
              fields: Object.keys(externalWinningValues)
            })
            const integrationTargetContext: GithubNextIntegrationTargetContext = {
              client,
              markup,
              integration: workspaceIntegration._id,
              provider: providerContext.provider._id
            }
            await updateIntegrationTarget(integrationTargetContext, outboundTargetDoc, externalWinningValues)
            const refreshed = await client.findOne(state.targetClass, { _id: state.targetId })
            if (refreshed !== undefined) {
              outboundTargetDoc = refreshed
            }
          }

          const diffPatch = await buildIssuePatch(client, markup, outboundTargetDoc, providerContext.binding, secret.secret, githubContext, {
            state,
            externalMappedValues,
            localModifiedOn: getObjectModifiedOn(outboundTargetDoc)
          })
          const githubPatch = withoutUndefined({
            title: diffPatch.title,
            body: diffPatch.body,
            state: diffPatch.state,
            assignees: diffPatch.assignees,
            labels: diffPatch.labels
          })
          console.info('[github-next-service] issue outbound diff patch prepared', {
            state: state._id,
            targetClass: outboundTargetDoc._class,
            targetId: outboundTargetDoc._id,
            externalNumber: state.externalNumber,
            fields: Object.keys(githubPatch),
            assignees: githubPatch.assignees,
            labels: githubPatch.labels,
            targetHashChanged: diffPatch.targetHash !== state.targetHash
          })
          if (!hasDefinedValue(githubPatch)) {
            if (Object.keys(externalWinningValues).length > 0) {
              const targetValues = await fetchMappedTargetValues(client, markup, outboundTargetDoc, providerContext.binding, 'markup')
              await client.update(state, {
                externalVersion: externalIssue.updatedAt,
                externalUpdatedAt: Date.parse(externalIssue.updatedAt),
                externalHash: stableHash(externalMappedValues),
                externalValues: externalMappedValues,
                targetHash: stableHash(targetValues),
                targetValues,
                lastDirection: 'inbound',
                lastSyncedOn: Date.now()
              })
              result.updated++
              continue
            }
            result.skipped++
            continue
          }

          const updated = await patchGithubIssue(
            secret.secret,
            { owner: repository.owner, name: repository.name },
            state.externalNumber,
            githubPatch,
            githubContext
          )
          const updatedExternalValues = applyIntegrationSlotBinding(
            await normalizeIssueSlots(client, updated),
            providerContext.binding
          )
          const targetValues = await fetchMappedTargetValues(client, markup, outboundTargetDoc, providerContext.binding, 'markup')
          await client.update(state, {
            externalVersion: updated.updatedAt,
            externalUpdatedAt: Date.parse(updated.updatedAt),
            externalHash: stableHash(updatedExternalValues),
            externalValues: updatedExternalValues,
            targetHash: stableHash(targetValues),
            targetValues,
            lastDirection: 'outbound',
            lastSyncedOn: Date.now()
          })
          result.updated++
          continue
        }

        result.discussionsSeen++
        let outboundTargetDoc = targetDoc
        const currentTargetValues = await fetchMappedTargetValues(client, markup, outboundTargetDoc, providerContext.binding, 'markup')
        const externalDiscussion = await getGithubDiscussion(secret.secret, state.externalId)
        const externalMappedValues = applyIntegrationSlotBinding(
          normalizeDiscussionSlots(externalDiscussion),
          providerContext.binding
        )
        const externalWinningValues = getOutboundExternalWinningTargetValues(
          providerContext.binding,
          currentTargetValues,
          externalMappedValues,
          state,
          getObjectModifiedOn(outboundTargetDoc)
        )
        if (Object.keys(externalWinningValues).length > 0) {
          ctx.info('GitHub Next outbound pre-applies external winning discussion fields', {
            state: state._id,
            targetClass: outboundTargetDoc._class,
            targetId: outboundTargetDoc._id,
            fields: Object.keys(externalWinningValues)
          })
          const integrationTargetContext: GithubNextIntegrationTargetContext = {
            client,
            markup,
            integration: workspaceIntegration._id,
            provider: providerContext.provider._id
          }
          await updateIntegrationTarget(integrationTargetContext, outboundTargetDoc, externalWinningValues)
          const refreshed = await client.findOne(state.targetClass, { _id: state.targetId })
          if (refreshed !== undefined) {
            outboundTargetDoc = refreshed
          }
        }
        const patch = await buildDiscussionPatch(
          client,
          markup,
          repository,
          secret.secret,
          outboundTargetDoc,
          providerContext.binding,
          {
            state,
            externalMappedValues,
            localModifiedOn: getObjectModifiedOn(outboundTargetDoc)
          }
        )
        const discussionPatch = withoutUndefined({
          title: patch.title,
          body: patch.body,
          categoryId: patch.categoryId
        })
        if (!hasDefinedValue(discussionPatch)) {
          if (Object.keys(externalWinningValues).length > 0) {
            const targetValues = await fetchMappedTargetValues(client, markup, outboundTargetDoc, providerContext.binding, 'markup')
            await client.update(state, {
              externalVersion: externalDiscussion.updatedAt,
              externalUpdatedAt: Date.parse(externalDiscussion.updatedAt),
              externalHash: stableHash(externalMappedValues),
              externalValues: externalMappedValues,
              targetHash: stableHash(targetValues),
              targetValues,
              lastDirection: 'inbound',
              lastSyncedOn: Date.now()
            })
            result.updated++
            continue
          }
          result.skipped++
          continue
        }

        const updated = await updateGithubDiscussion(secret.secret, state.externalId, discussionPatch)
        const updatedExternalValues = applyIntegrationSlotBinding(normalizeDiscussionSlots(updated), providerContext.binding)
        const targetValues = await fetchMappedTargetValues(client, markup, outboundTargetDoc, providerContext.binding, 'markup')
        await client.update(state, {
          externalVersion: updated.updatedAt,
          externalUpdatedAt: Date.parse(updated.updatedAt),
          externalHash: stableHash(updatedExternalValues),
          externalValues: updatedExternalValues,
          targetHash: stableHash(targetValues),
          targetValues,
          lastDirection: 'outbound',
          lastSyncedOn: Date.now()
        })
        result.updated++
      }
    }
  } finally {
    await client.close()
  }

  return result
}

export async function syncGithubNextWorkspace (
  ctx: MeasureContext,
  accountsUrl: string,
  workspaceUuid: WorkspaceUuid
): Promise<SyncGithubNextWorkspaceResult> {
  return await syncInboundIssues(ctx, accountsUrl, workspaceUuid)
}

export async function syncGithubNextDiscussions (
  ctx: MeasureContext,
  accountsUrl: string,
  workspaceUuid: WorkspaceUuid
): Promise<SyncGithubNextWorkspaceResult> {
  return await syncInboundDiscussions(ctx, accountsUrl, workspaceUuid)
}

export async function syncGithubNextOutboundIssues (
  ctx: MeasureContext,
  accountsUrl: string,
  workspaceUuid: WorkspaceUuid
): Promise<SyncGithubNextWorkspaceResult> {
  return await syncOutboundForProvider(ctx, accountsUrl, workspaceUuid, 'issue')
}

export async function syncGithubNextOutboundDiscussions (
  ctx: MeasureContext,
  accountsUrl: string,
  workspaceUuid: WorkspaceUuid
): Promise<SyncGithubNextWorkspaceResult> {
  return await syncOutboundForProvider(ctx, accountsUrl, workspaceUuid, 'discussion')
}
