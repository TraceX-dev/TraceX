/**

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { type AccountRole } from '@hcengineering/core'
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs
} from '@playwright/test'
import { ApiEndpoint } from '../API/Api'
import { WorkspaceRestClient } from '../API/WorkspaceRestClient'
import { type SignUpData } from '../model/common-types'
import { LeftSideMenuPage } from '../model/left-side-menu-page'
import { LoginPage } from '../model/login-page'
import { PlatformSetting, PlatformURI, PlatformUser, PlatformWs, setTestOptions } from '../utils'

/** Password of the sanity-ws dump users. */
export const OWNER_PASSWORD = '1234'

/** Text of the status the server rejects a forbidden tx with. */
export const FORBIDDEN = 'platform:status:Forbidden'

export interface OpenedPage {
  page: Page
  context: BrowserContext
}

export async function withRequest<T> (
  playwright: PlaywrightWorkerArgs['playwright'],
  fn: (request: APIRequestContext) => Promise<T>
): Promise<T> {
  const request = await playwright.request.newContext()
  try {
    return await fn(request)
  } finally {
    await request.dispose()
  }
}

/**
 * Signs the user up, joins it to sanity-ws with the given role and opens the workbench once.
 * The Employee (and Person) of a new member is created on the first workbench connect, so a member
 * can be added to spaces, and can send txes, only after that.
 */
export async function createWorkspaceMember (
  playwright: PlaywrightWorkerArgs['playwright'],
  browser: Browser,
  user: SignUpData,
  role: AccountRole
): Promise<void> {
  await withRequest(playwright, async (request) => {
    const api = new ApiEndpoint(request)
    await api.createAccount(user.email, user.password, user.firstName, user.lastName)
    const inviteId = await api.createWorkspaceInvite(PlatformUser, OWNER_PASSWORD, PlatformWs, role)
    await api.joinWorkspace(user.email, user.password, inviteId, PlatformWs)
  })

  const { page, context } = await loginAs(browser, user)
  try {
    await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}`))?.finished()
    await expect(new LeftSideMenuPage(page).profileButton()).toBeVisible()
  } finally {
    await context.close()
  }
}

export async function loginAs (browser: Browser, user: SignUpData): Promise<OpenedPage> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await (await page.goto(`${PlatformURI}/login/login`))?.finished()
  await new LoginPage(page).login(user.email, user.password)
  await page.waitForURL((url) => !url.pathname.startsWith('/login/login'))
  return { page, context }
}

export async function openAsOwner (browser: Browser): Promise<OpenedPage> {
  const context = await browser.newContext({ storageState: PlatformSetting })
  const page = await context.newPage()
  await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}`))?.finished()
  await setTestOptions(page)
  return { page, context }
}

export async function connectRest (request: APIRequestContext, user: SignUpData): Promise<WorkspaceRestClient> {
  return await WorkspaceRestClient.connect(request, user.email, user.password, PlatformWs)
}

export async function connectOwnerRest (request: APIRequestContext): Promise<WorkspaceRestClient> {
  return await WorkspaceRestClient.connect(request, PlatformUser, OWNER_PASSWORD, PlatformWs)
}

/**
 * "New issue" button of the tracker. IssuesPage.buttonCreateNewIssue expects the split button of a
 * regular user (`button > div`); for a guest it is a plain button, so locate it by role.
 */
export function newIssueButton (page: Page): Locator {
  return page.getByRole('button', { name: 'New issue', exact: true }).first()
}

/** Minimal markup of a single paragraph, as stored in `ChatMessage.message`. */
export function markup (text: string): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
}
