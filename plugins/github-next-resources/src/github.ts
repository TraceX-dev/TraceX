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

import { getClient as getAccountClientRaw } from '@hcengineering/account-client'
import { concatLink, getCurrentAccount, type WorkspaceUuid } from '@hcengineering/core'
import githubNext, { type GithubNextRepositorySelection } from '@hcengineering/github-next'
import login from '@hcengineering/login'
import { getMetadata } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'

interface GithubUserResponse {
  login: string
  type?: 'User' | 'Organization'
}

interface GithubRepositoryResponse {
  id: number
  node_id: string
  name: string
  default_branch?: string
  html_url?: string
  owner: {
    login: string
  }
}

export interface GithubNextAuthorizationState {
  token: string
  socialId: string
  workspaceUuid: WorkspaceUuid
}

function makeQuery (params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

function getGithubNextServiceUrl (): string {
  const url = getMetadata(githubNext.metadata.GithubNextURL)
  if (url == null || url === '') {
    throw new Error('GitHub Next service URL is not configured.')
  }
  return url
}

function getHulyToken (): string {
  const token = getMetadata(presentation.metadata.Token)
  if (token == null || token === '') {
    throw new Error('Huly token is not defined.')
  }
  return token
}

async function requestGithub<T> (path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message !== '' ? message : `GitHub request failed with ${response.status}`)
  }

  return await response.json()
}

export async function validateGithubToken (token: string): Promise<GithubUserResponse> {
  return await requestGithub<GithubUserResponse>('/user', token)
}

export async function listGithubRepositories (token: string): Promise<GithubNextRepositorySelection[]> {
  const repositories: GithubNextRepositorySelection[] = []

  for (let page = 1; page <= 10; page++) {
    const batch = await requestGithub<GithubRepositoryResponse[]>(
      `/user/repos?sort=updated&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`,
      token
    )

    repositories.push(
      ...batch.map((repository) => ({
        owner: repository.owner.login,
        name: repository.name,
        repositoryId: repository.id,
        nodeId: repository.node_id,
        defaultBranch: repository.default_branch,
        htmlUrl: repository.html_url
      }))
    )

    if (batch.length < 100) {
      break
    }
  }

  repositories.sort((left, right) => {
    return `${left.owner}/${left.name}`.localeCompare(`${right.owner}/${right.name}`)
  })

  return repositories
}

export async function authorizeGithubNext (): Promise<void> {
  const authWindow = window.open('', '_blank')
  if (authWindow == null) {
    throw new Error('Failed to open GitHub authorization window.')
  }

  try {
    const clientId = getMetadata(githubNext.metadata.GithubClientID)
    if (clientId == null || clientId === '') {
      throw new Error('GitHub OAuth client id is not configured.')
    }

    const accountsUrl = getMetadata(login.metadata.AccountsUrl)
    if (accountsUrl == null || accountsUrl === '') {
      throw new Error('Accounts URL is not configured.')
    }

    const token = getHulyToken()
    const accountClient = getAccountClientRaw(accountsUrl, token)
    const workspace = await accountClient.getWorkspaceInfo()
    const state: GithubNextAuthorizationState = {
      token,
      socialId: getCurrentAccount().primarySocialId,
      workspaceUuid: workspace.uuid
    }

    const url =
      'https://github.com/login/oauth/authorize?' +
      makeQuery({
        client_id: clientId,
        redirect_uri: concatLink(getGithubNextServiceUrl(), '/api/v1/oauth/callback'),
        scope: 'repo read:org',
        state: btoa(JSON.stringify(state)),
        allow_signup: 'true'
      })

    authWindow.location.href = url
  } catch (err) {
    authWindow.close()
    throw err
  }
}

export async function listAuthorizedGithubRepositories (): Promise<{
  user: GithubUserResponse
  repositories: GithubNextRepositorySelection[]
}> {
  const token = getHulyToken()
  const accountsUrl = getMetadata(login.metadata.AccountsUrl)
  if (accountsUrl == null || accountsUrl === '') {
    throw new Error('Accounts URL is not configured.')
  }

  const accountClient = getAccountClientRaw(accountsUrl, token)
  const workspace = await accountClient.getWorkspaceInfo()
  const response = await fetch(concatLink(getGithubNextServiceUrl(), '/api/v1/repositories'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      token,
      socialId: getCurrentAccount().primarySocialId,
      workspaceUuid: workspace.uuid
    })
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message !== '' ? message : `GitHub Next service request failed with ${response.status}`)
  }

  return await response.json()
}

export async function triggerGithubNextSync (): Promise<void> {
  const token = getHulyToken()
  const accountsUrl = getMetadata(login.metadata.AccountsUrl)
  if (accountsUrl == null || accountsUrl === '') {
    throw new Error('Accounts URL is not configured.')
  }

  const accountClient = getAccountClientRaw(accountsUrl, token)
  const workspace = await accountClient.getWorkspaceInfo()
  const response = await fetch(concatLink(getGithubNextServiceUrl(), '/api/v1/sync'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      token,
      socialId: getCurrentAccount().primarySocialId,
      workspaceUuid: workspace.uuid
    })
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message !== '' ? message : `GitHub Next sync request failed with ${response.status}`)
  }
}
