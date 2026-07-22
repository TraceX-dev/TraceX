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

import {
  getClient as getAccountClientRaw,
  type AccountClient,
  type Integration as AccountIntegration
} from '@hcengineering/account-client'
import core, { getCurrentAccount, type Class, type Doc, type Ref } from '@hcengineering/core'
import githubNext, {
  githubNextIntegrationKind,
  githubNextIntegrationSettingValue,
  type GithubNextCapabilities,
  type GithubNextIntegrationData,
  type GithubNextRepositorySelection
} from '@hcengineering/github-next'
import integration, {
  saveIntegrationSetup,
  type IntegrationRoutingPolicy,
  type IntegrationRoutingTarget,
  type IntegrationSlotBinding,
  type IntegrationSlotProvider,
  type IntegrationValueMapping
} from '@hcengineering/integration'
import login from '@hcengineering/login'
import { getMetadata } from '@hcengineering/platform'
import presentation, { getClient } from '@hcengineering/presentation'
import setting, { type Integration as WorkspaceIntegration } from '@hcengineering/setting'

export function getAccountClient (): AccountClient {
  const accountsUrl = getMetadata(login.metadata.AccountsUrl)
  const token = getMetadata(presentation.metadata.Token)
  if (accountsUrl === undefined || token === undefined) {
    throw new Error('Accounts URL or token is not defined')
  }

  return getAccountClientRaw(accountsUrl, token)
}

export function getRepositoryKey (repository: Pick<GithubNextRepositorySelection, 'owner' | 'name'>): string {
  return `${repository.owner}/${repository.name}`
}

export async function ensureWorkspaceGithubNextIntegration (): Promise<WorkspaceIntegration> {
  const client = getClient()
  let integrationDoc = await client.findOne(setting.class.Integration, {
    type: githubNext.integrationType.GithubNext,
    value: githubNextIntegrationSettingValue
  })

  if (integrationDoc === undefined) {
    const id = await client.createDoc(setting.class.Integration, core.space.Workspace, {
      type: githubNext.integrationType.GithubNext,
      disabled: false,
      value: githubNextIntegrationSettingValue,
      shared: []
    })
    integrationDoc = await client.findOne(setting.class.Integration, { _id: id })
  }

  if (integrationDoc === undefined) {
    throw new Error('Failed to create workspace GitHub Next integration doc')
  }

  return integrationDoc
}

export async function getGithubNextProviderSetup (workspaceIntegration: WorkspaceIntegration): Promise<{
  provider: IntegrationSlotProvider | undefined
  binding: IntegrationSlotBinding | undefined
  routingPolicy: IntegrationRoutingPolicy | undefined
}> {
  return await getGithubNextProviderSetupById(workspaceIntegration, githubNext.ids.GithubNextIssueProvider)
}

export async function getGithubNextProviderSetupById (
  workspaceIntegration: WorkspaceIntegration,
  providerId: Ref<IntegrationSlotProvider>
): Promise<{
    provider: IntegrationSlotProvider | undefined
    binding: IntegrationSlotBinding | undefined
    routingPolicy: IntegrationRoutingPolicy | undefined
  }> {
  const client = getClient()
  const provider = await client.findOne(integration.class.IntegrationSlotProvider, {
    _id: providerId
  })
  if (provider === undefined) {
    return { provider: undefined, binding: undefined, routingPolicy: undefined }
  }

  const binding = await client.findOne(integration.class.IntegrationSlotBinding, { provider: provider._id })
  const routingPolicy = await client.findOne(integration.class.IntegrationRoutingPolicy, {
    integration: workspaceIntegration._id,
    provider: provider._id
  })

  return { provider, binding, routingPolicy }
}

export async function saveGithubNextProviderSetup (
  workspaceIntegration: WorkspaceIntegration,
  params: {
    provider: Ref<IntegrationSlotProvider>
    targetClass: Ref<Class<Doc>>
    bindings: Record<string, string>
    fallback: IntegrationRoutingTarget
    valueMappings?: Record<string, IntegrationValueMapping>
  }
): Promise<{
    binding: IntegrationSlotBinding
    policy: IntegrationRoutingPolicy
  }> {
  return await saveGithubNextProviderSetupById(workspaceIntegration, params)
}

export async function saveGithubNextProviderSetupById (
  workspaceIntegration: WorkspaceIntegration,
  params: {
    provider: Ref<IntegrationSlotProvider>
    targetClass: Ref<Class<Doc>>
    bindings: Record<string, string>
    fallback: IntegrationRoutingTarget
    valueMappings?: Record<string, IntegrationValueMapping>
  }
): Promise<{
    binding: IntegrationSlotBinding
    policy: IntegrationRoutingPolicy
  }> {
  const client = getClient()
  return await saveIntegrationSetup(client, {
    integration: workspaceIntegration._id,
    provider: params.provider,
    targetClass: params.targetClass,
    bindings: params.bindings,
    valueMappings: params.valueMappings,
    fallback: {
      space: params.fallback.space,
      targetClass: params.fallback.targetClass
    }
  })
}

export async function upsertGithubNextIntegration (
  integration: AccountIntegration | undefined,
  repositories: GithubNextRepositorySelection[],
  capabilities: GithubNextCapabilities,
  accountLogin: string,
  accountType: GithubNextIntegrationData['accountType'],
  token?: string
): Promise<void> {
  const accountClient = getAccountClient()
  const workspace = await accountClient.getWorkspaceInfo()
  const socialId = integration?.socialId ?? getCurrentAccount().primarySocialId
  const workspaceUuid = integration?.workspaceUuid ?? workspace.uuid

  const integrationData: GithubNextIntegrationData = {
    accountLogin,
    accountType,
    repositories,
    capabilities
  }

  const integrationKey = {
    socialId,
    kind: githubNextIntegrationKind,
    workspaceUuid
  }

  const existing = integration ?? (await accountClient.getIntegration(integrationKey))
  if (existing === null) {
    await accountClient.createIntegration({
      ...integrationKey,
      data: integrationData
    })
  } else {
    await accountClient.updateIntegration({
      ...existing,
      data: {
        ...(existing.data ?? {}),
        ...integrationData
      }
    })
  }

  if (token !== undefined && token.trim() !== '') {
    const secretKey = {
      ...integrationKey,
      key: 'token'
    }
    const existingSecret = await accountClient.getIntegrationSecret(secretKey)

    if (existingSecret === null) {
      await accountClient.addIntegrationSecret({
        ...secretKey,
        secret: token
      })
    } else {
      await accountClient.updateIntegrationSecret({
        ...existingSecret,
        secret: token
      })
    }
  }
}

export async function disconnectGithubNextIntegration (integration: AccountIntegration): Promise<void> {
  const accountClient = getAccountClient()
  await accountClient
    .deleteIntegrationSecret({
      socialId: integration.socialId,
      kind: integration.kind,
      workspaceUuid: integration.workspaceUuid,
      key: 'token'
    })
    .catch(() => {})

  await accountClient.deleteIntegration({
    socialId: integration.socialId,
    kind: integration.kind,
    workspaceUuid: integration.workspaceUuid
  })
}
