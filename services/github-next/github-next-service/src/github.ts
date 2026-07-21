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

import type {
  GithubNextAssignee,
  GithubNextDiscussion,
  GithubNextDiscussionCategory,
  GithubNextIssue,
  GithubNextRepositorySelection
} from '@hcengineering/github-next'

interface GithubUserResponse {
  login: string
  type?: 'User' | 'Organization'
  name?: string | null
  email?: string | null
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

interface GithubIssueResponse {
  id: number
  node_id: string
  number: number
  title: string
  body?: string | null
  state: 'open' | 'closed'
  html_url: string
  updated_at: string
  assignees?: Array<{ login: string }>
  labels?: Array<{ name?: string | null }>
  pull_request?: Record<string, unknown>
}

interface GithubSearchUsersResponse {
  total_count: number
  items: GithubUserResponse[]
}

export interface GithubIssueComment {
  id: number
  nodeId?: string
  body?: string
  htmlUrl?: string
  updatedAt: string
  createdAt: string
  authorLogin?: string
}

interface GithubIssueCommentResponse {
  id: number
  node_id?: string
  body?: string | null
  html_url?: string
  updated_at: string
  created_at: string
  user?: {
    login?: string | null
  } | null
}

interface GithubDiscussionCategoryResponse {
  id: string
  name: string
}

interface GithubDiscussionResponse {
  id: string
  number: number
  title: string
  body?: string | null
  url: string
  updatedAt: string
  closed: boolean
  category?: GithubDiscussionCategoryResponse | null
}

export interface GithubRequestContext {
  userCache: Map<string, GithubNextAssignee>
  userSearchCache: Map<string, string | undefined>
}

class GithubHttpError extends Error {
  constructor (
    readonly status: number,
    readonly headers: Headers,
    message: string
  ) {
    super(message)
  }
}

const githubMaxAttempts = 3
const githubBaseRetryDelayMs = 1000
const githubMaxRetryDelayMs = 15_000

export function createGithubRequestContext (): GithubRequestContext {
  return {
    userCache: new Map(),
    userSearchCache: new Map()
  }
}

function shouldRetryGithubRequest (status: number): boolean {
  return status === 403 || status === 429 || status >= 500
}

function getGithubRetryDelay (headers: Headers, attempt: number): number {
  const retryAfter = headers.get('retry-after')
  if (retryAfter !== null) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) {
      return Math.min(seconds * 1000, githubMaxRetryDelayMs)
    }
  }

  const reset = headers.get('x-ratelimit-reset')
  if (reset !== null) {
    const resetAt = Number(reset) * 1000
    if (Number.isFinite(resetAt)) {
      const delay = resetAt - Date.now()
      if (delay > 0) return Math.min(delay, githubMaxRetryDelayMs)
    }
  }

  return Math.min(githubBaseRetryDelayMs * 2 ** attempt, githubMaxRetryDelayMs)
}

async function sleep (ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function retryGithub<T> (fn: () => Promise<T>): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < githubMaxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const retryable =
        err instanceof GithubHttpError
          ? shouldRetryGithubRequest(err.status)
          : err instanceof TypeError
      if (!retryable || attempt === githubMaxAttempts - 1) {
        throw err
      }

      const delay = err instanceof GithubHttpError
        ? getGithubRetryDelay(err.headers, attempt)
        : Math.min(githubBaseRetryDelayMs * 2 ** attempt, githubMaxRetryDelayMs)
      await sleep(delay)
    }
  }

  throw lastError
}

async function requestGithub<T> (
  path: string,
  token: string,
  init?: {
    method?: string
    body?: Record<string, unknown>
  }
): Promise<T> {
  return await retryGithub(async () => {
    const response = await fetch(`https://api.github.com${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
    })

    if (!response.ok) {
      const message = await response.text()
      throw new GithubHttpError(response.status, response.headers, message || `GitHub request failed with status ${response.status}`)
    }

    if (response.status === 204) {
      return undefined as T
    }

    return await response.json()
  })
}

async function requestGithubGraphql<T> (
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return await retryGithub(async () => {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({ query, variables })
    })

    const payload = await response.json()
    if (!response.ok) {
      throw new GithubHttpError(response.status, response.headers, JSON.stringify(payload))
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new Error(payload.errors.map((it: any) => it.message ?? JSON.stringify(it)).join('; '))
    }

    return payload.data as T
  })
}

function toRepositorySelection (repository: GithubRepositoryResponse): GithubNextRepositorySelection {
  return {
    owner: repository.owner.login,
    name: repository.name,
    repositoryId: repository.id,
    nodeId: repository.node_id,
    defaultBranch: repository.default_branch,
    htmlUrl: repository.html_url
  }
}

function toGithubAssignee (user: GithubUserResponse): GithubNextAssignee {
  return {
    login: user.login,
    name: user.name ?? undefined,
    email: user.email ?? undefined
  }
}

function toGithubIssue (issue: GithubIssueResponse, repository: GithubNextRepositorySelection): GithubNextIssue {
  const assigneeLogins = issue.assignees?.map((assignee) => assignee.login).filter((login) => login !== '')
  return {
    id: issue.id,
    nodeId: issue.node_id,
    number: issue.number,
    title: issue.title,
    body: issue.body ?? undefined,
    state: issue.state,
    htmlUrl: issue.html_url,
    updatedAt: issue.updated_at,
    assigneeLogins,
    assignees: assigneeLogins?.map((login) => ({ login })),
    labels: issue.labels?.map((label) => label.name ?? '').filter((label) => label !== ''),
    repository
  }
}

export async function getGithubUser (
  token: string,
  login: string,
  context?: GithubRequestContext
): Promise<GithubNextAssignee> {
  const normalizedLogin = login.trim().toLowerCase()
  const cached = context?.userCache.get(normalizedLogin)
  if (cached !== undefined) return cached

  const assignee = toGithubAssignee(await requestGithub<GithubUserResponse>(`/users/${login}`, token))
  context?.userCache.set(normalizedLogin, assignee)
  return assignee
}

async function enrichGithubIssueAssignees (
  token: string,
  issue: GithubNextIssue,
  context?: GithubRequestContext
): Promise<GithubNextIssue> {
  if (issue.assigneeLogins === undefined || issue.assigneeLogins.length === 0) {
    return issue
  }

  const assignees: GithubNextAssignee[] = []
  for (const login of issue.assigneeLogins) {
    try {
      assignees.push(await getGithubUser(token, login, context))
    } catch {
      assignees.push({ login })
    }
  }

  return {
    ...issue,
    assignees
  }
}

function toGithubIssueComment (comment: GithubIssueCommentResponse): GithubIssueComment {
  return {
    id: comment.id,
    nodeId: comment.node_id,
    body: comment.body ?? undefined,
    htmlUrl: comment.html_url,
    updatedAt: comment.updated_at,
    createdAt: comment.created_at,
    authorLogin: comment.user?.login ?? undefined
  }
}

function toDiscussionCategory (
  category: GithubDiscussionCategoryResponse | null | undefined
): GithubNextDiscussionCategory | undefined {
  if (category == null) return undefined

  return {
    id: category.id,
    name: category.name
  }
}

function toGithubDiscussion (
  discussion: GithubDiscussionResponse,
  repository: GithubNextRepositorySelection
): GithubNextDiscussion {
  return {
    id: discussion.id,
    number: discussion.number,
    title: discussion.title,
    body: discussion.body ?? undefined,
    state: discussion.closed ? 'closed' : 'open',
    htmlUrl: discussion.url,
    updatedAt: discussion.updatedAt,
    category: toDiscussionCategory(discussion.category),
    repository
  }
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

    repositories.push(...batch.map(toRepositorySelection))

    if (batch.length < 100) {
      break
    }
  }

  repositories.sort((left, right) => `${left.owner}/${left.name}`.localeCompare(`${right.owner}/${right.name}`))
  return repositories
}

export async function getGithubRepository (
  token: string,
  repository: Pick<GithubNextRepositorySelection, 'owner' | 'name'>
): Promise<GithubNextRepositorySelection> {
  const response = await requestGithub<GithubRepositoryResponse>(
    `/repos/${repository.owner}/${repository.name}`,
    token
  )
  return toRepositorySelection(response)
}

export async function listGithubIssues (
  token: string,
  repository: GithubNextRepositorySelection,
  context?: GithubRequestContext
): Promise<GithubNextIssue[]> {
  const issues: GithubNextIssue[] = []

  for (let page = 1; page <= 10; page++) {
    const batch = await requestGithub<GithubIssueResponse[]>(
      `/repos/${repository.owner}/${repository.name}/issues?state=all&per_page=100&page=${page}`,
      token
    )

    for (const issue of batch.filter((issue) => issue.pull_request === undefined)) {
      issues.push(await enrichGithubIssueAssignees(token, toGithubIssue(issue, repository), context))
    }

    if (batch.length < 100) {
      break
    }
  }

  return issues
}

export async function getGithubIssue (
  token: string,
  repository: Pick<GithubNextRepositorySelection, 'owner' | 'name'>,
  issueNumber: number,
  context?: GithubRequestContext
): Promise<GithubNextIssue> {
  const issue = await requestGithub<GithubIssueResponse>(
    `/repos/${repository.owner}/${repository.name}/issues/${issueNumber}`,
    token
  )
  return await enrichGithubIssueAssignees(token, toGithubIssue(issue, {
    owner: repository.owner,
    name: repository.name
  }), context)
}

export async function patchGithubIssue (
  token: string,
  repository: Pick<GithubNextRepositorySelection, 'owner' | 'name'>,
  issueNumber: number,
  patch: {
    title?: string
    body?: string
    state?: 'open' | 'closed'
    assignees?: string[]
    labels?: string[]
  },
  context?: GithubRequestContext
): Promise<GithubNextIssue> {
  const issue = await requestGithub<GithubIssueResponse>(
    `/repos/${repository.owner}/${repository.name}/issues/${issueNumber}`,
    token,
    {
      method: 'PATCH',
      body: patch
    }
  )
  return await enrichGithubIssueAssignees(token, toGithubIssue(issue, {
    owner: repository.owner,
    name: repository.name
  }), context)
}

export async function createGithubIssue (
  token: string,
  repository: Pick<GithubNextRepositorySelection, 'owner' | 'name'>,
  issue: {
    title: string
    body?: string
    assignees?: string[]
    labels?: string[]
  },
  context?: GithubRequestContext
): Promise<GithubNextIssue> {
  const created = await requestGithub<GithubIssueResponse>(
    `/repos/${repository.owner}/${repository.name}/issues`,
    token,
    {
      method: 'POST',
      body: {
        title: issue.title,
        body: issue.body,
        assignees: issue.assignees,
        labels: issue.labels
      }
    }
  )
  return await enrichGithubIssueAssignees(token, toGithubIssue(created, {
    owner: repository.owner,
    name: repository.name
  }), context)
}

async function findGithubUserLoginByQuery (
  token: string,
  query: string,
  context?: GithubRequestContext
): Promise<string | undefined> {
  const cached = context?.userSearchCache.get(query)
  if (context?.userSearchCache.has(query) === true) return cached

  const result = await requestGithub<GithubSearchUsersResponse>(
    `/search/users?q=${encodeURIComponent(query)}&per_page=2`,
    token
  )
  const login = result.total_count === 1 && result.items[0]?.login !== undefined ? result.items[0].login : undefined
  context?.userSearchCache.set(query, login)
  return login
}

export async function findGithubUserLoginByEmail (
  token: string,
  email: string,
  context?: GithubRequestContext
): Promise<string | undefined> {
  const normalizedEmail = email.trim().toLowerCase()
  if (normalizedEmail === '') return undefined

  return await findGithubUserLoginByQuery(token, `${normalizedEmail} in:email type:user`, context)
}

export async function findGithubUserLoginByName (
  token: string,
  name: string,
  context?: GithubRequestContext
): Promise<string | undefined> {
  const normalizedName = name.trim()
  if (normalizedName === '') return undefined

  return await findGithubUserLoginByQuery(token, `"${normalizedName}" in:fullname type:user`, context)
}

export async function listGithubIssueComments (
  token: string,
  repository: Pick<GithubNextRepositorySelection, 'owner' | 'name'>,
  issueNumber: number
): Promise<GithubIssueComment[]> {
  const comments: GithubIssueComment[] = []

  for (let page = 1; page <= 10; page++) {
    const batch = await requestGithub<GithubIssueCommentResponse[]>(
      `/repos/${repository.owner}/${repository.name}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      token
    )

    comments.push(...batch.map(toGithubIssueComment))
    if (batch.length < 100) break
  }

  return comments
}

export async function createGithubIssueComment (
  token: string,
  repository: Pick<GithubNextRepositorySelection, 'owner' | 'name'>,
  issueNumber: number,
  body: string
): Promise<GithubIssueComment> {
  const created = await requestGithub<GithubIssueCommentResponse>(
    `/repos/${repository.owner}/${repository.name}/issues/${issueNumber}/comments`,
    token,
    {
      method: 'POST',
      body: { body }
    }
  )
  return toGithubIssueComment(created)
}

export async function updateGithubIssueComment (
  token: string,
  repository: Pick<GithubNextRepositorySelection, 'owner' | 'name'>,
  commentId: number,
  body: string
): Promise<GithubIssueComment> {
  const updated = await requestGithub<GithubIssueCommentResponse>(
    `/repos/${repository.owner}/${repository.name}/issues/comments/${commentId}`,
    token,
    {
      method: 'PATCH',
      body: { body }
    }
  )
  return toGithubIssueComment(updated)
}

export async function deleteGithubIssueComment (
  token: string,
  repository: Pick<GithubNextRepositorySelection, 'owner' | 'name'>,
  commentId: number
): Promise<void> {
  try {
    await requestGithub<void>(
      `/repos/${repository.owner}/${repository.name}/issues/comments/${commentId}`,
      token,
      {
        method: 'DELETE'
      }
    )
  } catch (err) {
    if (err instanceof GithubHttpError && err.status === 404) return
    throw err
  }
}

export async function listGithubDiscussionCategories (
  token: string,
  repository: Pick<GithubNextRepositorySelection, 'owner' | 'name'>
): Promise<GithubNextDiscussionCategory[]> {
  const data = await requestGithubGraphql<{
    repository: {
      discussionCategories: {
        nodes: GithubDiscussionCategoryResponse[]
      }
    } | null
  }>(
    token,
    `
      query ListDiscussionCategories($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          discussionCategories(first: 100) {
            nodes {
              id
              name
            }
          }
        }
      }
    `,
    {
      owner: repository.owner,
      name: repository.name
    }
  )

  return (data.repository?.discussionCategories.nodes ?? [])
    .map((category) => toDiscussionCategory(category))
    .filter((category): category is GithubNextDiscussionCategory => category !== undefined)
}

export async function listGithubDiscussions (
  token: string,
  repository: GithubNextRepositorySelection
): Promise<GithubNextDiscussion[]> {
  const discussions: GithubNextDiscussion[] = []
  let cursor: string | null = null

  while (true) {
    const data: {
      repository: {
        discussions: {
          nodes: GithubDiscussionResponse[]
          pageInfo: {
            hasNextPage: boolean
            endCursor: string | null
          }
        }
      } | null
    } = await requestGithubGraphql<{
      repository: {
        discussions: {
          nodes: GithubDiscussionResponse[]
          pageInfo: {
            hasNextPage: boolean
            endCursor: string | null
          }
        }
      } | null
    }>(
      token,
      `
        query ListDiscussions($owner: String!, $name: String!, $cursor: String) {
          repository(owner: $owner, name: $name) {
            discussions(first: 100, after: $cursor) {
              nodes {
                id
                number
                title
                body
                url
                updatedAt
                closed
                category {
                  id
                  name
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      {
        owner: repository.owner,
        name: repository.name,
        cursor
      }
    )

    const connection: {
      nodes: GithubDiscussionResponse[]
      pageInfo: {
        hasNextPage: boolean
        endCursor: string | null
      }
    } | undefined = data.repository?.discussions
    if (connection == null) {
      break
    }

    discussions.push(...connection.nodes.map((discussion) => toGithubDiscussion(discussion, repository)))
    if (!connection.pageInfo.hasNextPage) {
      break
    }

    cursor = connection.pageInfo.endCursor
    if (cursor == null) {
      break
    }
  }

  return discussions
}

export async function getGithubDiscussion (
  token: string,
  discussionId: string
): Promise<GithubNextDiscussion> {
  const data = await requestGithubGraphql<{
    node: (GithubDiscussionResponse & {
      repository: {
        owner: {
          login: string
        }
        name: string
      }
    }) | null
  }>(
    token,
    `
      query GetDiscussion($id: ID!) {
        node(id: $id) {
          ... on Discussion {
            id
            number
            title
            body
            url
            updatedAt
            closed
            category {
              id
              name
            }
            repository {
              owner {
                login
              }
              name
            }
          }
        }
      }
    `,
    { id: discussionId }
  )

  if (data.node == null) {
    throw new Error(`GitHub discussion not found: ${discussionId}`)
  }

  return toGithubDiscussion(data.node, {
    owner: data.node.repository.owner.login,
    name: data.node.repository.name
  })
}

export async function updateGithubDiscussion (
  token: string,
  discussionId: string,
  patch: {
    title?: string
    body?: string
    categoryId?: string
  }
): Promise<GithubNextDiscussion> {
  const data = await requestGithubGraphql<{
    updateDiscussion: {
      discussion: GithubDiscussionResponse & {
        repository: {
          owner: {
            login: string
          }
          name: string
        }
      }
    }
  }>(
    token,
    `
      mutation UpdateDiscussion($input: UpdateDiscussionInput!) {
        updateDiscussion(input: $input) {
          discussion {
            id
            number
            title
            body
            url
            updatedAt
            closed
            category {
              id
              name
            }
            repository {
              owner {
                login
              }
              name
            }
          }
        }
      }
    `,
    {
      input: {
        discussionId,
        ...patch
      }
    }
  )

  const discussion = data.updateDiscussion.discussion
  return toGithubDiscussion(discussion, {
    owner: discussion.repository.owner.login,
    name: discussion.repository.name
  })
}

export async function createGithubDiscussion (
  token: string,
  repository: Pick<GithubNextRepositorySelection, 'owner' | 'name' | 'nodeId'>,
  discussion: {
    title: string
    body?: string
    categoryId: string
  }
): Promise<GithubNextDiscussion> {
  if (repository.nodeId === undefined) {
    throw new Error(`GitHub repository node id is required to create discussion ${repository.owner}/${repository.name}`)
  }

  const data = await requestGithubGraphql<{
    createDiscussion: {
      discussion: GithubDiscussionResponse & {
        repository: {
          owner: {
            login: string
          }
          name: string
        }
      }
    }
  }>(
    token,
    `
      mutation CreateDiscussion($input: CreateDiscussionInput!) {
        createDiscussion(input: $input) {
          discussion {
            id
            number
            title
            body
            url
            updatedAt
            closed
            category {
              id
              name
            }
            repository {
              owner {
                login
              }
              name
            }
          }
        }
      }
    `,
    {
      input: {
        repositoryId: repository.nodeId,
        title: discussion.title,
        body: discussion.body,
        categoryId: discussion.categoryId
      }
    }
  )

  const created = data.createDiscussion.discussion
  return toGithubDiscussion(created, {
    owner: created.repository.owner.login,
    name: created.repository.name
  })
}
