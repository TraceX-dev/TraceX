//
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
//

import {
  createGithubRequestContext,
  getGithubRepository,
  hasGithubRepositoryDiscussions,
  hasGithubRepositoryIssues
} from '../github'

describe('repository sync availability', () => {
  const repository = { owner: 'TraceX-dev', name: 'TraceX' }
  const originalFetch = globalThis.fetch
  let fetchMock: jest.MockedFunction<typeof fetch>

  beforeEach(() => {
    fetchMock = jest.fn()
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('shares the full repository response between availability checks and repository lookups', async () => {
    const context = createGithubRequestContext()
    const response = {
      id: 1,
      node_id: 'repository-node-id',
      name: repository.name,
      owner: { login: repository.owner },
      has_issues: false,
      has_discussions: true,
      default_branch: 'main',
      html_url: 'https://github.com/TraceX-dev/TraceX',
      description: 'Repository metadata'
    }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response)))

    expect(await hasGithubRepositoryIssues('test-token', repository, context)).toBe(false)
    expect(await hasGithubRepositoryDiscussions('test-token', repository, context)).toBe(true)
    expect(await getGithubRepository('test-token', repository, context)).toEqual({
      owner: repository.owner,
      name: repository.name,
      repositoryId: response.id,
      nodeId: response.node_id,
      defaultBranch: response.default_branch,
      htmlUrl: response.html_url
    })
    expect(await context.repositoryCache.get('TraceX-dev/TraceX')).toEqual(response)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])('caches has_issues=%s within the same context', async (hasIssues) => {
    const context = createGithubRequestContext()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ has_issues: hasIssues })))

    for (let pass = 0; pass < 70; pass++) {
      expect(await hasGithubRepositoryIssues('test-token', repository, context)).toBe(hasIssues)
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/TraceX-dev/TraceX',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it.each([true, false])('refreshes has_issues=%s in a new sync context', async (hasIssues) => {
    const context = createGithubRequestContext()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ has_issues: hasIssues })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ has_issues: !hasIssues })))

    expect(await hasGithubRepositoryIssues('test-token', repository, context)).toBe(hasIssues)
    expect(await hasGithubRepositoryIssues('test-token', repository, context)).toBe(hasIssues)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    expect(await hasGithubRepositoryIssues('test-token', repository, createGithubRequestContext())).toBe(!hasIssues)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([true, false])('caches has_discussions=%s independently of issues', async (hasDiscussions) => {
    const context = createGithubRequestContext()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ has_issues: !hasDiscussions, has_discussions: hasDiscussions }))
    )

    expect(await hasGithubRepositoryIssues('test-token', repository, context)).toBe(!hasDiscussions)
    expect(await hasGithubRepositoryDiscussions('test-token', repository, context)).toBe(hasDiscussions)
    expect(await hasGithubRepositoryDiscussions('test-token', repository, context)).toBe(hasDiscussions)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])('refreshes has_discussions=%s in a new sync context', async (hasDiscussions) => {
    const context = createGithubRequestContext()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ has_discussions: hasDiscussions })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ has_discussions: !hasDiscussions })))

    expect(await hasGithubRepositoryDiscussions('test-token', repository, context)).toBe(hasDiscussions)
    expect(await hasGithubRepositoryDiscussions('test-token', repository, context)).toBe(hasDiscussions)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    expect(await hasGithubRepositoryDiscussions('test-token', repository, createGithubRequestContext())).toBe(
      !hasDiscussions
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares in-flight metadata requests within the same context', async () => {
    const context = createGithubRequestContext()
    let resolveResponse: (response: Response) => void = () => {}
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      })
    )

    const first = hasGithubRepositoryIssues('test-token', repository, context)
    const second = hasGithubRepositoryDiscussions('test-token', repository, context)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveResponse(new Response(JSON.stringify({ has_issues: false, has_discussions: true })))
    expect(await Promise.all([first, second])).toEqual([false, true])
  })

  it('keeps metadata isolated by repository', async () => {
    const context = createGithubRequestContext()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ has_issues: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ has_issues: true })))

    expect(await hasGithubRepositoryIssues('test-token', repository, context)).toBe(false)
    expect(await hasGithubRepositoryIssues('test-token', { ...repository, name: 'other' }, context)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache metadata without a context', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ has_issues: false })))

    expect(await hasGithubRepositoryIssues('test-token', repository)).toBe(false)
    expect(await hasGithubRepositoryIssues('test-token', repository)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares a failed request within a context and retries with a new context', async () => {
    const context = createGithubRequestContext()
    fetchMock
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ has_issues: true })))

    await expect(hasGithubRepositoryIssues('test-token', repository, context)).rejects.toThrow('Not found')
    await expect(hasGithubRepositoryIssues('test-token', repository, context)).rejects.toThrow('Not found')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await hasGithubRepositoryIssues('test-token', repository, createGithubRequestContext())).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
