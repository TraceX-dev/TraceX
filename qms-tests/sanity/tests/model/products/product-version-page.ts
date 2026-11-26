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

import { HomepageURI, PlatformURI } from '../../utils'

/** The panel of a product version (`EditProductVersion`). */
export class ProductVersionPage {
  readonly page: Page
  readonly changeControlButton: Locator
  readonly popup: Locator

  constructor (page: Page) {
    this.page = page
    this.changeControlButton = page
      .locator('span.labelOnPanel', { hasText: /^\s*Change control\s*$/ })
      .locator('xpath=following-sibling::div[1]')
      .locator('button')
      .first()
    this.popup = page.locator('div.selectPopup')
  }

  async open (versionId: string): Promise<void> {
    const panel = encodeURIComponent(
      `products:component:EditProductVersion|${versionId}|products:class:ProductVersion|content`
    )
    await (await this.page.goto(`${PlatformURI}/${HomepageURI}/products/product-versions#${panel}`))?.finished()
    await expect(this.changeControlButton).toBeVisible()
  }

  async checkChangeControl (label: string): Promise<void> {
    await expect(this.changeControlButton).toContainText(label)
  }

  async changeChangeControl (label: string): Promise<void> {
    await this.changeControlButton.click()
    await expect(this.popup).toBeVisible()
    await this.popup.locator('button', { hasText: label }).first().click()
    await expect(this.popup).toBeHidden()
    await this.checkChangeControl(label)
  }

  async checkOptionIsNotOffered (label: string): Promise<void> {
    await this.changeControlButton.click()
    await expect(this.popup).toBeVisible()
    await expect(this.popup.locator('button', { hasText: label })).toHaveCount(0)
    await this.page.keyboard.press('Escape')
    await expect(this.popup).toBeHidden()
  }

  /** A read-only change control opens no picker. */
  async checkChangeControlIsReadonly (label: string): Promise<void> {
    await this.checkChangeControl(label)
    await this.changeControlButton.click()
    // The picker opens asynchronously: give it time to show up before checking that it did not.
    await this.page.waitForTimeout(1000)
    await expect(this.popup).toBeHidden()
  }
}
