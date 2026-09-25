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

import { AccountRole } from '@hcengineering/core'
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { ApiEndpoint } from '../API/Api'
import { LeftSideMenuPage } from '../model/left-side-menu-page'
import { LoginPage } from '../model/login-page'
import { SpotlightPopup } from '../model/spotlight-popup'
import { IssuesDetailsPage } from '../model/tracker/issues-details-page'
import { IssuesPage } from '../model/tracker/issues-page'
import { NewProjectPage } from '../model/tracker/new-project-page'
import { TrackerNavigationMenuPage } from '../model/tracker/tracker-navigation-menu-page'
import { prepareNewIssueWithOpenStep } from '../tracker/common-steps'
import { generateProjectId } from '../tracker/tracker.utils'
import {
  generateId,
  generateUser,
  PlatformSetting,
  PlatformURI,
  PlatformUser,
  PlatformWs,
  setTestOptions,
  waitForNetworIdle
} from '../utils'

// Employees of the sanity-ws dump.
// PlatformUser: creates the private project and shares it with the guest.
const VISIBLE_NAME = 'Appleseed John'
// Not a member of the private project, so it has no common space with the guest.
const HIDDEN_NAME = 'Chen Rosamund'

// The mention popup and spotlight search asynchronously; give a negative check time to settle.
const SEARCH_SETTLE_MS = 1000

interface OpenedPage {
  page: Page
  context: BrowserContext
}

test.describe('Guest person visibility', () => {
  test.describe.configure({ mode: 'serial' })

  const guest = generateUser()
  const guestName = `${guest.lastName} ${guest.firstName}`
  const projectId = generateProjectId()
  const projectTitle = `Guest-${projectId}`
  const issueTitle = `Guest visibility issue-${generateId()}`
  let issueUrl = ''

  test.beforeAll(async ({ browser, playwright }) => {
    // Setup creates an account, a project and an issue through the UI: more than a single test budget.
    test.setTimeout(180_000)

    const request = await playwright.request.newContext()
    try {
      const api = new ApiEndpoint(request)
      await api.createAccount(guest.email, guest.password, guest.firstName, guest.lastName)
      const inviteId = await api.createWorkspaceInvite(PlatformUser, '1234', PlatformWs, AccountRole.Guest)
      await api.joinWorkspace(guest.email, guest.password, inviteId, PlatformWs)
    } finally {
      await request.dispose()
    }

    // Employee (and its Person) of a new member is created on the first workbench connect,
    // so the guest has to open the workspace once before it can be added to a project.
    const guestSession = await loginAsGuest(browser)
    try {
      await (await guestSession.page.goto(`${PlatformURI}/workbench/${PlatformWs}`))?.finished()
      await expect(new LeftSideMenuPage(guestSession.page).profileButton()).toBeVisible()
    } finally {
      await guestSession.context.close()
    }

    const { page, context } = await openAsOwner(browser)
    try {
      await new TrackerNavigationMenuPage(page).pressCreateProjectButton()
      await new NewProjectPage(page).createNewProject({
        title: projectTitle,
        identifier: projectId,
        description: 'Private project shared with a guest',
        private: true,
        members: [guestName]
      })
      await new TrackerNavigationMenuPage(page).checkProjectExist(projectTitle)

      await prepareNewIssueWithOpenStep(page, {
        title: issueTitle,
        description: 'Issue assigned to an employee the guest must not see',
        projectName: projectTitle,
        assignee: HIDDEN_NAME
      })
      await new IssuesDetailsPage(page).waitDetailsOpened(issueTitle)
      issueUrl = page.url()
    } finally {
      await context.close()
    }
  })

  async function openAsOwner (browser: Browser): Promise<OpenedPage> {
    const context = await browser.newContext({ storageState: PlatformSetting })
    const page = await context.newPage()
    await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}`))?.finished()
    await setTestOptions(page)
    return { page, context }
  }

  async function loginAsGuest (browser: Browser): Promise<OpenedPage> {
    const context = await browser.newContext()
    const page = await context.newPage()
    await (await page.goto(`${PlatformURI}/login/login`))?.finished()
    await new LoginPage(page).login(guest.email, guest.password)
    await page.waitForURL((url) => !url.pathname.startsWith('/login/login'))
    return { page, context }
  }

  async function openIssueAsGuest (browser: Browser): Promise<OpenedPage & { details: IssuesDetailsPage }> {
    const { page, context } = await loginAsGuest(browser)
    await (await page.goto(issueUrl))?.finished()
    await setTestOptions(page)

    const details = new IssuesDetailsPage(page)
    // Issue fields are read-only for a guest: the title is a disabled input, not text.
    await expect(details.inputTitle()).toHaveValue(issueTitle)
    return { page, context, details }
  }

  /**
   * Opens the tracker; pickers for guests are checked in the "New issue" form, no issue needed.
   */
  async function openTrackerAsGuest (browser: Browser): Promise<OpenedPage> {
    const { page, context } = await loginAsGuest(browser)
    await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}/tracker`))?.finished()
    await setTestOptions(page)
    await expect(newIssueButton(page)).toBeVisible()
    return { page, context }
  }

  /**
   * Opens the "New issue" form. Its assignee picker and description editor (mentions) are editable
   * for a guest, unlike the fields of an existing issue.
   */
  // IssuesPage.buttonCreateNewIssue expects the split button of a regular user (`button > div`);
  // for a guest "New issue" is a plain button, so locate it by role.
  function newIssueButton (page: Page): Locator {
    return page.getByRole('button', { name: 'New issue', exact: true }).first()
  }

  async function openNewIssueForm (page: Page): Promise<IssuesPage> {
    const issuesPage = new IssuesPage(page)
    await newIssueButton(page).click()
    await expect(issuesPage.buttonPopupCreateNewIssueAssignee()).toBeVisible()
    return issuesPage
  }

  test('Guest sees only project members in the assignee picker', async ({ browser }) => {
    const { page, context } = await openTrackerAsGuest(browser)
    try {
      const issuesPage = await openNewIssueForm(page)
      await issuesPage.buttonPopupCreateNewIssueAssignee().click()
      // Check the full, unfiltered list: positive and negative checks come from the same render.
      await expect(issuesPage.selectPopupListItem(VISIBLE_NAME)).toBeVisible()
      await expect(issuesPage.selectPopupListItem(guestName)).toBeVisible()
      await expect(issuesPage.selectPopupListItem(HIDDEN_NAME)).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('Guest can not mention a hidden employee', async ({ browser }) => {
    const { page, context } = await openTrackerAsGuest(browser)
    try {
      const issuesPage = await openNewIssueForm(page)
      const description = issuesPage.inputPopupCreateNewIssueDescription()

      await description.fill(`@${VISIBLE_NAME.split(' ')[0]}`)
      await expect(issuesPage.mentionPopupListItem(VISIBLE_NAME).first()).toBeVisible()

      await description.fill(`@${HIDDEN_NAME.split(' ')[0]}`)
      await page.waitForTimeout(SEARCH_SETTLE_MS)
      await expect(issuesPage.mentionPopupListItem(HIDDEN_NAME)).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('Guest can not find a hidden employee in spotlight', async ({ browser }) => {
    const { page, context } = await openTrackerAsGuest(browser)
    try {
      const spotlight = new SpotlightPopup(page)
      await spotlight.open()

      await spotlight.fillSearchInput(VISIBLE_NAME)
      await expect(spotlight.searchResult(VISIBLE_NAME).first()).toBeVisible()

      await spotlight.fillSearchInput(HIDDEN_NAME)
      await page.waitForTimeout(SEARCH_SETTLE_MS)
      await spotlight.checkSearchResult(HIDDEN_NAME, 0)
    } finally {
      await context.close()
    }
  })

  test('Guest does not see a hidden assignee of a visible issue', async ({ browser }) => {
    const { page, context } = await openIssueAsGuest(browser)
    try {
      // Let person lookups of the opened issue finish before checking the absence.
      await waitForNetworIdle(page)
      await expect(page.getByText(HIDDEN_NAME)).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('Regular user still sees every employee', async ({ browser }) => {
    const { page, context } = await openAsOwner(browser)
    try {
      await (await page.goto(issueUrl))?.finished()
      const details = new IssuesDetailsPage(page)
      await expect(details.inputTitle()).toHaveValue(issueTitle)
      await expect(details.buttonAssignee()).toContainText(HIDDEN_NAME)

      const spotlight = new SpotlightPopup(page)
      await spotlight.open()
      await spotlight.fillSearchInput(HIDDEN_NAME)
      await expect(spotlight.searchResult(HIDDEN_NAME).first()).toBeVisible()
      await spotlight.close()

      // Same pickers as in the guest tests.
      await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}/tracker`))?.finished()
      const issuesPage = await openNewIssueForm(page)
      await issuesPage.buttonPopupCreateNewIssueAssignee().click()
      // The full employee list is long and virtualized, so search for the hidden employee explicitly.
      await issuesPage.selectPopupInput().fill(HIDDEN_NAME.split(' ')[0])
      await expect(issuesPage.selectPopupListItem(HIDDEN_NAME)).toBeVisible()
      await page.keyboard.press('Escape')

      await issuesPage.inputPopupCreateNewIssueDescription().fill(`@${HIDDEN_NAME.split(' ')[0]}`)
      await expect(issuesPage.mentionPopupListItem(HIDDEN_NAME).first()).toBeVisible()
    } finally {
      await context.close()
    }
  })
})
