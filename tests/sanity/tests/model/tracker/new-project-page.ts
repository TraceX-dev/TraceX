import { expect, type Locator } from '@playwright/test'
import { CommonTrackerPage } from './common-tracker-page'
import { NewProject } from './types'

export class NewProjectPage extends CommonTrackerPage {
  popupHeader = (): Locator =>
    this.page.locator('form[id="tracker:string:NewProject"] div[class*="title"]:last-child', {
      hasText: 'New project'
    })

  inputTitle = (): Locator => this.page.locator('div[id="project-title"] input')
  inputIdentifier = (): Locator => this.page.locator('div[id="project-identifier"] input')
  inputDescription = (): Locator => this.page.locator('div[id="project-description"] input')
  buttonChooseIcon = (): Locator => this.page.locator('div.formRow button.only-icon')
  buttonMakePrivate = (): Locator => this.page.locator('[id="project-private"]')
  buttonCreateProject = (): Locator => this.page.locator('form[id="tracker:string:NewProject"] button[type="submit"]')
  projectTypeButton = (): Locator =>
    this.page.locator('div[class*="header"]', { hasText: 'Project type' }).locator('xpath=..').locator('button')

  defaultAssigneeButton = (): Locator =>
    this.page
      .locator('div[class*="header"]', { hasText: 'Default assignee for issues' })
      .locator('xpath=..')
      .locator('button')

  buttonMembers = (): Locator =>
    this.page
      .locator('form[id="tracker:string:NewProject"] .formRow', {
        has: this.page.locator('.formRow__label', { hasText: /^Members$/ })
      })
      .locator('.formRow__value button')
      .first()

  defaultIssueStatusButton = (): Locator =>
    this.page.locator('div[class*="header"]', { hasText: 'Default issue status' }).locator('xpath=..').locator('button')

  async createNewProject (data: NewProject): Promise<void> {
    await expect(this.popupHeader()).toBeVisible()

    if (data.type != null) {
      await this.projectTypeButton().click()
      await this.selectMenuItem(this.page, data.type)
    }

    if (data.title != null) {
      await this.inputTitle().fill(data.title)
    }
    if (data.identifier != null) {
      await this.inputIdentifier().fill(data.identifier)
    }
    if (data.description != null) {
      await this.inputDescription().fill(data.description)
    }
    if (data.iconNumber != null) {
      await this.buttonChooseIcon().click()
    }
    if (data.private) {
      await this.buttonMakePrivate().click()
    }
    if (data.members != null && data.members.length > 0) {
      await this.buttonMembers().click()
      for (const member of data.members) {
        await this.selectPopupInput().fill(member.split(' ')[0])
        await this.selectPopupListItem(member).click()
        await expect(this.selectPopupListItem(member).locator('.check svg')).toBeVisible()
      }
      await this.page.keyboard.press('Escape')
      // AccountArrayEditor applies member changes with a 500ms debounce; submitting earlier drops them.
      await this.page.waitForTimeout(600)
    }
    if (data.defaultAssigneeForIssues != null) {
      await this.defaultAssigneeButton().click()
      await this.selectMenuItem(this.page, data.defaultAssigneeForIssues)
    }
    if (data.defaultIssueStatus != null) {
      await this.defaultIssueStatusButton().click()
      await this.selectFromDropdown(this.page, data.defaultIssueStatus)
    }

    await this.buttonCreateProject().click()
  }
}
