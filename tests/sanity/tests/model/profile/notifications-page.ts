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

export enum MenuItems {
  COMPANIES = 'Companies',
  PERSONS = 'Persons',
  CHAT = 'Chat',
  REVIEW = 'Review',
  APPLICATION = 'Application',
  VACANCY = 'Vacancy',
  TALENT = 'Talent',
  SETTING = 'Setting',
  TELEGRAM = 'Telegram',
  EMAIL = 'Email',
  NOTIFICATIONS = 'Notifications',
  ISSUES = 'Issues',
  DOCUMENTS = 'Documents',
  REQUESTS = 'Requests',
  TODOS = "Todo's"
}

export class NotificationsPage {
  private readonly page: Page

  companies = (): Locator => this.page.getByRole('button', { name: 'Companies' })
  persons = (): Locator => this.page.getByRole('button', { name: 'Persons' })
  chat = (): Locator => this.page.getByRole('button', { name: 'Chat' })
  review = (): Locator => this.page.getByRole('button', { name: 'Review' })
  application = (): Locator => this.page.getByRole('button', { name: 'Application' })
  vacancy = (): Locator => this.page.getByRole('button', { name: 'Vacancy' })
  talent = (): Locator => this.page.getByRole('button', { name: 'Talent' })
  setting = (): Locator => this.page.getByRole('button', { name: 'Setting' })
  telegram = (): Locator => this.page.getByRole('button', { name: 'Telegram' })
  email = (): Locator => this.page.getByRole('button', { name: 'Email' })
  notifications = (): Locator => this.page.getByRole('button', { name: 'Notifications' })
  issues = (): Locator => this.page.getByRole('button', { name: 'Issues' })
  documents = (): Locator => this.page.getByRole('button', { name: 'Documents' })
  requests = (): Locator => this.page.getByRole('button', { name: 'Requests' })
  todos = (): Locator => this.page.getByRole('button', { name: "Todo's" })
  chatMessageToggle = (): Locator =>
    this.page.getByTestId(
      'notification-toggle-chunter:ids:ChannelNotification-notification:providers:InboxNotificationProvider'
    )

  constructor (page: Page) {
    this.page = page
  }

  async clickMenuItem (item: MenuItems): Promise<void> {
    switch (item) {
      case MenuItems.COMPANIES:
        await this.companies().click()
        break
      case MenuItems.PERSONS:
        await this.persons().click()
        break
      case MenuItems.CHAT:
        await this.chat().click()
        break
      case MenuItems.REVIEW:
        await this.review().click()
        break
      case MenuItems.APPLICATION:
        await this.application().click()
        break
      case MenuItems.VACANCY:
        await this.vacancy().click()
        break
      case MenuItems.TALENT:
        await this.talent().click()
        break
      case MenuItems.SETTING:
        await this.setting().click()
        break
      case MenuItems.TELEGRAM:
        await this.telegram().click()
        break
      case MenuItems.EMAIL:
        await this.email().click()
        break
      case MenuItems.NOTIFICATIONS:
        await this.notifications().click()
        break
      case MenuItems.ISSUES:
        await this.issues().click()
        break
      case MenuItems.DOCUMENTS:
        await this.documents().click()
        break
      case MenuItems.REQUESTS:
        await this.requests().click()
        break
      case MenuItems.TODOS:
        await this.todos().click()
        break
      default:
        throw new Error('Unknown button type')
    }
  }

  async toggleChatMessage (): Promise<void> {
    const toggle = this.chatMessageToggle()
    const checkbox = toggle.locator('input[type="checkbox"]')
    await expect(checkbox).toBeChecked()
    await toggle.locator('label').click()
    await expect(checkbox).not.toBeChecked()
  }
}
