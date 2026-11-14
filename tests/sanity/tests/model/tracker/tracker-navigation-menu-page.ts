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
import { expect, type Locator, type Page } from '@playwright/test'
import { CommonPage } from '../common-page'

export class TrackerNavigationMenuPage extends CommonPage {
  page: Page

  constructor (page: Page) {
    super(page)
    this.page = page
  }

  yoursProjectsMenuSelector = '#navGroup-tree-projects'
  starredProjectsMenuSelector = '#navGroup-tree-stared'

  buttonCreateProject = (): Locator =>
    this.page.locator(this.yoursProjectsMenuSelector).locator('xpath=../div[contains(@class, "hulyNavGroup-header")]')

  buttonProjectsParent = (): Locator => this.page.locator('.hulyNavGroup-header__toggle')
  templateLinkForProject = (projectName: string): Locator =>
    this.page.locator(`a[href$="templates"][href*="${projectName}"]`)

  starredProjectsInMenu = (): Locator =>
    this.page.locator(`${this.starredProjectsMenuSelector} .hulyNavGroup-header__toggle`)

  issuesLinkForProject = (projectName: string): Locator =>
    this.page
      .getByRole('button', { name: projectName, exact: true })
      .locator('xpath=../following-sibling::div[1]/a[contains(@href, "issues")]', { hasText: 'Issues' })

  milestonesLinkForProject = (projectName: string): Locator =>
    this.page.locator(`a[href$="milestones"][href*="${projectName}"] > button[class*="hulyNavItem-container"] > span`, {
      hasText: 'Milestones'
    })

  componentsLinkForProject = (projectName: string): Locator =>
    this.page.locator(`a[href$="components"][href*="${projectName}"] > button[class*="hulyNavItem-container"] > span`, {
      hasText: 'Components'
    })

  newIssue = (): Locator => this.page.locator('button', { hasText: 'New issue' })
  myIssues = (): Locator => this.page.getByRole('link', { name: 'My issues', exact: true })
  allIssues = (): Locator => this.page.getByRole('link', { name: 'All issues', exact: true })
  allProjects = (): Locator => this.page.getByRole('link', { name: 'All projects' })
  issues = (): Locator => this.page.getByRole('link', { name: 'Issues', exact: true })
  components = (): Locator => this.page.getByRole('link', { name: 'Components' })
  milestone = (): Locator => this.page.getByRole('link', { name: 'Milestones' })
  templates = (): Locator => this.page.getByRole('link', { name: 'Templates' })

  createProjectButton = (): Locator => this.buttonCreateProject().locator('#tree-projects')

  async pressCreateProjectButton (): Promise<void> {
    await this.buttonCreateProject().hover()
    await this.createProjectButton().click()
  }

  async checkProjectExist (projectName: string): Promise<void> {
    await expect(this.buttonProjectsParent().filter({ hasText: projectName })).toHaveCount(1)
  }

  async checkProjectStarred (projectName: string): Promise<void> {
    await expect(this.starredProjectsInMenu().filter({ hasText: projectName })).toHaveCount(1)
  }

  async checkProjectWillBeRemovedFromYours (projectName: string): Promise<void> {
    await this.page.waitForSelector(`${this.yoursProjectsMenuSelector} span:has-text("${projectName}")`, {
      state: 'detached'
    })
  }

  async checkProjectWillBeRemovedFromStarred (projectName: string): Promise<void> {
    await this.page.waitForSelector(`${this.starredProjectsMenuSelector} span:has-text("${projectName}")`, {
      state: 'detached'
    })
  }

  async checkProjectNotExist (projectName: string): Promise<void> {
    await expect(this.buttonProjectsParent().filter({ hasText: projectName })).toHaveCount(0)
  }

  async openProject (projectName: string): Promise<void> {
    await this.buttonProjectsParent().filter({ hasText: projectName }).click()
  }

  async openTemplateForProject (projectName: string): Promise<void> {
    await this.templateLinkForProject(projectName).click()
  }

  async openIssuesForProject (projectName: string): Promise<void> {
    await this.issuesLinkForProject(projectName).click()
  }

  async makeActionWithProject (projectName: string, action: string): Promise<void> {
    await this.buttonProjectsParent().filter({ hasText: projectName }).hover()
    await this.buttonProjectsParent()
      .filter({ hasText: projectName })
      .locator('xpath=..')
      .locator('.hulyNavGroup-header__actions button')
      .last()
      .click()
    await this.selectFromDropdown(this.page, action)
  }

  async makeActionWithStarredProject (projectName: string, action: string): Promise<void> {
    await this.starredProjectsInMenu().filter({ hasText: projectName }).hover()
    await this.starredProjectsInMenu()
      .filter({ hasText: projectName })
      .locator('xpath=..')
      .locator('.hulyNavGroup-header__actions button')
      .last()
      .click()
    await this.selectFromDropdown(this.page, action)
  }

  async openMilestonesForProject (projectName: string): Promise<void> {
    await this.milestonesLinkForProject(projectName).click()
  }

  async openComponentsForProject (projectName: string): Promise<void> {
    await this.componentsLinkForProject(projectName).click()
  }

  async checkIfTrackerSidebarIsVisible (): Promise<void> {
    await expect(this.newIssue()).toBeVisible()
    await expect(this.myIssues()).toBeVisible()
    await expect(this.allIssues()).toBeVisible()
    await expect(this.allProjects()).toBeVisible()
  }

  async checkIfTrackerSidebarIsVisibleForLiveProject (): Promise<void> {
    await expect(this.issues()).toBeVisible()
    await expect(this.components()).toBeVisible()
    await expect(this.milestone()).toBeVisible()
    await expect(this.templates()).toBeVisible()
  }

  async openAllProjects (): Promise<void> {
    await this.allProjects().click()
  }
}
