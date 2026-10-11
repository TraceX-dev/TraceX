import { type Locator, type Page } from '@playwright/test'

export enum ButtonType {
  General,
  Members,
  SpaceRoles,
  TextTemplate,
  RelatedIssues,
  Classes,
  Enums,
  InviteSettings
}

export class WorkspaceSettingsPage {
  readonly page: Page

  constructor (page: Page) {
    this.page = page
  }

  general = (): Locator => this.page.getByRole('button', { name: 'General' })
  accessManagement = (): Locator => this.page.getByRole('button', { name: 'Access management', exact: true })

  accessManagementTab = (name: 'Members' | 'Spaces' | 'Space roles'): Locator =>
    this.page.getByRole('button', { name, exact: true })

  textTemplate = (): Locator => this.page.getByRole('button', { name: 'Text Templates' })
  relatedIssues = (): Locator => this.page.getByRole('button', { name: 'Related issues' })
  classes = (): Locator => this.page.locator('#navGroup-setting').getByRole('button', { name: 'Classes' })
  enums = (): Locator => this.page.getByRole('button', { name: 'Enums' })
  inviteSettings = (): Locator => this.page.getByRole('button', { name: 'Invite settings' })

  async selectAccessManagementTab (name: 'Members' | 'Spaces' | 'Space roles'): Promise<void> {
    await this.accessManagement().click()
    await this.accessManagementTab(name).click()
  }

  async selectWorkspaceSettingsTab (button: ButtonType): Promise<void> {
    switch (button) {
      case ButtonType.General:
        await this.general().click()
        break
      case ButtonType.Members:
        await this.selectAccessManagementTab('Members')
        break
      case ButtonType.SpaceRoles:
        await this.selectAccessManagementTab('Space roles')
        break
      case ButtonType.TextTemplate:
        await this.textTemplate().click()
        break
      case ButtonType.RelatedIssues:
        await this.relatedIssues().click()
        break
      case ButtonType.Classes:
        await this.classes().click()
        break
      case ButtonType.Enums:
        await this.enums().click()
        break
      case ButtonType.InviteSettings:
        await this.inviteSettings().click()
        break
      default:
        throw new Error('Unknown button type')
    }
  }
}
