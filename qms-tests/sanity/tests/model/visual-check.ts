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

import { expect, Page } from '@playwright/test'
import { join } from 'path'

export class VisualCheck {
  readonly page: Page

  constructor (page: Page) {
    this.page = page
  }

  async compareScreenshot (selector: string | null, screenshotName: string): Promise<void> {
    let screenshot

    if (selector !== null && selector !== undefined) {
      const element = this.page.locator(selector)
      await expect(element).toBeVisible()
      screenshot = await element.screenshot()
    } else {
      screenshot = await this.page.screenshot()
    }

    // Compare the screenshot with the stored snapshot
    expect(screenshot).toMatchSnapshot(join(__dirname, '..', 'screenshots', `${screenshotName}.png`), {
      maxDiffPixelRatio: 0.2
    })
  }

  async comparePDFPreview (screenshotName: string): Promise<void> {
    // Wait for the iframe to be present in the DOM
    const iframe = this.page.locator('form.antiDialog iframe[title$=".pdf"]')
    await iframe.waitFor({ state: 'attached', timeout: 10000 })

    // Wait for the iframe to finish loading
    await this.page.waitForFunction(
      () => {
        const iframe = document.querySelector<HTMLIFrameElement>('form.antiDialog iframe[title$=".pdf"]')
        return iframe?.contentDocument?.readyState === 'complete'
      },
      { timeout: 30000 }
    )

    const pdfPreviewModal = this.page.locator('.antiDialog > .content')
    await expect(pdfPreviewModal).toBeVisible()

    const screenshot = await this.page.screenshot()

    expect(screenshot).toMatchSnapshot(join(__dirname, '..', 'screenshots', `${screenshotName}.png`), {
      maxDiffPixelRatio: 0.2
    })
  }
}
