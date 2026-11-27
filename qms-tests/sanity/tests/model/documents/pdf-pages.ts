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

import { type Locator, type Page, expect } from '@playwright/test'

export class PdfPages {
  readonly page: Page
  readonly exportAction: Locator
  readonly exportSettings: Locator
  readonly pdfPreview: Locator
  readonly downloadPdf: Locator
  readonly showFullScreenPdf: Locator

  constructor (page: Page) {
    this.page = page
    this.exportAction = page.locator('.antiPopup').getByRole('button', { name: 'Export…', exact: true })
    this.exportSettings = page.locator('form[id="export:string:Export"]')
    this.pdfPreview = page.locator('form.antiDialog iframe[title$=".pdf"]')
    const viewer = page.locator('form.antiDialog').filter({ has: page.locator('iframe[title$=".pdf"]') })
    this.downloadPdf = viewer.locator('a[download]')
    this.showFullScreenPdf = viewer.locator('#btnDialogFullScreen')
  }

  async printToPdfClick (): Promise<void> {
    await this.exportAction.click()
    await expect(this.exportSettings).toBeVisible()
    await expect(this.exportSettings.locator('[data-id="export-format"]')).toHaveText('PDF')
    await expect(this.exportSettings.locator('[data-id="export-preview"]').getByRole('checkbox')).toBeChecked()
    await this.exportSettings.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(this.exportSettings).toHaveCount(0, { timeout: 120000 })
    await expect(this.pdfPreview).toBeVisible({ timeout: 120000 })
  }

  async showFullScreenPdfClick (): Promise<void> {
    await this.showFullScreenPdf.click()
  }

  async downloadAndVerifyPdf (): Promise<void> {
    const [download] = await Promise.all([this.page.waitForEvent('download'), this.downloadPdf.click()])
    const filePath = await download.path()
    expect(filePath).toBeTruthy()
    const fileName = download.suggestedFilename()
    expect(fileName).toMatch(/\.pdf$/)
  }
}
