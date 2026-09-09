import {
  ApiEndpoint,
  generateId,
  getSecondPage,
  IssuesDetailsPage,
  IssuesPage,
  LoginPage,
  NewIssue,
  SelectWorkspacePage,
  TrackerNavigationMenuPage
} from '@hcengineering/tests-sanity'
import { expect, test } from '@playwright/test'
import { AdminPage } from '../model/admin.page'

test.describe('Workspace Archive tests', () => {
  let loginPage: LoginPage
  let selectWorkspacePage: SelectWorkspacePage
  let trackerNavigationMenuPage: TrackerNavigationMenuPage
  let issuesPage: IssuesPage

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page)
    selectWorkspacePage = new SelectWorkspacePage(page)
    trackerNavigationMenuPage = new TrackerNavigationMenuPage(page)
    issuesPage = new IssuesPage(page)
  })

  test('New workspace with date, archive, unarchive', async ({ page, browser, request }) => {
    const api: ApiEndpoint = new ApiEndpoint(request)
    const wsId = generateId(5)
    await api.createWorkspaceWithLogin(wsId, 'user1', '1234')

    const newIssue: NewIssue = {
      title: `Issue with all parameters and attachments-${wsId}`,
      description: 'Created issue with all parameters and attachments description',
      status: 'In Progress',
      priority: 'Urgent',
      createLabel: true,
      labels: `CREATE-ISSUE-${wsId}`,
      component: 'No component',
      estimation: '2',
      milestone: 'No Milestone',
      duedate: 'today'
    }
    await test.step('create new workspace', async () => {
      await loginPage.goto()
      await loginPage.login('user1', '1234')

      await selectWorkspacePage.selectWorkspace(wsId)

      await trackerNavigationMenuPage.openIssuesForProject('Default')
      await issuesPage.clickModelSelectorAll()
      await issuesPage.createNewIssue(newIssue)
      await issuesPage.openIssueByName(newIssue.title)

      const issuesDetailsPage = new IssuesDetailsPage(page)
      await issuesDetailsPage.checkIssue(newIssue)
    })

    using adminSecondPage = await getSecondPage(browser)
    const page2 = adminSecondPage.page

    await test.step('Archive workspace', async () => {
      // login as admin
      const loginPage2 = new LoginPage(adminSecondPage.page)
      await loginPage2.goto()
      await loginPage2.login('admin', '1234')
      await loginPage2.page.waitForURL((url) => {
        return url.pathname.startsWith('/login/selectWorkspace') || url.pathname.startsWith('/workbench/')
      })

      await loginPage2.page.waitForURL((url) => {
        return url.pathname.startsWith('/login/selectWorkspace') || url.pathname.startsWith('/workbench/')
      })

      const adminPage = new AdminPage(page2)
      await adminPage.gotoAdmin()

      await page2.locator('[data-testid="workspace-search-container"] input').fill(wsId)
      const workspaceRow = page2.getByRole('row').filter({ hasText: wsId })
      await workspaceRow.getByTitle('Archive').click()

      await page2.getByRole('button', { name: 'Ok' }).click()
      await page2.locator('[data-id="tab-inactive"]').click()
      await expect(workspaceRow).toContainText('archived')
    })
    await test.step('Check workspace is archived', async () => {
      await page.reload() // Will redirect to select workspace page
      await page.getByText('archived').waitFor()
    })
    await test.step('Restore workspace', async () => {
      const workspaceRow = page2.getByRole('row').filter({ hasText: wsId })
      await workspaceRow.getByTitle('Unarchive').click()

      await page2.getByRole('button', { name: 'Ok' }).click()
      await page2.locator('[data-id="tab-active"]').click()
      await expect(workspaceRow).toContainText('active')
    })
    await test.step('Check workspace is active again', async () => {
      await page.reload()

      await selectWorkspacePage.selectWorkspace(wsId)

      const issuesDetailsPage = new IssuesDetailsPage(page)
      // Should be restored from previos remembered location.
      // await issuesPage.openIssueByName(newIssue.title)
      await issuesDetailsPage.checkIssue(newIssue)
    })
  })
})
