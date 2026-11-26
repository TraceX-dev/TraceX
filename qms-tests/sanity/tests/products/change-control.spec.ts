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

import { type APIRequestContext, type Browser, expect, type Page, request, test } from '@playwright/test'
import { allure } from 'allure-playwright'

import { ProductVersionPage } from '../model/products/product-version-page'
import { attachScreenshot, PlatformSetting, PlatformSettingQaraManager, PlatformSettingThird } from '../utils'
import {
  type ChangeControlFixture,
  type Clients,
  connectClients,
  getChangeControlCards,
  getVersionChangeControl,
  prepareCardChangeControl,
  prepareDocumentChangeControl
} from './change-control-data'

/**
 * A user assigned a wrong change control to a product version. The change control of the latest version can be
 * corrected by the product owner or by a member whose product role allows it (Manager, QARA), never in a released
 * version. Covers both kinds of change control: a controlled document and a card.
 *
 * Users: user1 is the owner and a QARA of the product, user_qara is a QARA, user3 is a Qualified User.
 */

async function openAs (browser: Browser, storageState: string): Promise<Page> {
  const context = await browser.newContext({ storageState })
  return await context.newPage()
}

test.describe('QMS. Products. Change control of a product version', () => {
  test.describe.configure({ mode: 'serial' })

  let clients: Clients
  // The `request` fixture of `beforeAll` is closed before the tests run, and the clients are used in the tests too.
  let api: APIRequestContext

  test.beforeAll(async () => {
    api = await request.newContext()
    clients = await connectClients(api)
  })

  test.afterAll(async () => {
    await api?.dispose()
  })

  test.describe('Controlled document', () => {
    let data: ChangeControlFixture

    test.beforeAll(async () => {
      data = await prepareDocumentChangeControl(clients)
    })

    test('Change control of the latest version is changed by a QARA', async ({ browser }) => {
      await allure.description('A QARA of the product replaces the wrong change control document of the latest version')
      const page = await openAs(browser, PlatformSettingQaraManager)
      const versionPage = new ProductVersionPage(page)

      await test.step('1. Open the latest version', async () => {
        await versionPage.open(data.latest)
        await versionPage.checkChangeControl(data.wrongChangeControl.label)
      })

      await test.step('2. A document used by another version is not offered', async () => {
        await versionPage.checkOptionIsNotOffered(data.releasedChangeControl.label)
      })

      await test.step('3. Select the right change control', async () => {
        await versionPage.changeChangeControl(data.rightChangeControl.label)
      })

      await test.step('4. The new change control is saved', async () => {
        await expect
          .poll(async () => await getVersionChangeControl(clients.user1, data.latest))
          .toBe(data.rightChangeControl._id)
        await versionPage.open(data.latest)
        await versionPage.checkChangeControl(data.rightChangeControl.label)
      })

      await attachScreenshot('change-control-document-changed.png', page)
      await page.context().close()
    })

    test('Change control of the latest version is changed by the product owner', async ({ browser }) => {
      const page = await openAs(browser, PlatformSetting)
      const versionPage = new ProductVersionPage(page)

      await versionPage.open(data.latest)
      await versionPage.changeChangeControl(data.wrongChangeControl.label)
      await expect
        .poll(async () => await getVersionChangeControl(clients.user1, data.latest))
        .toBe(data.wrongChangeControl._id)
      await page.context().close()
    })

    test('Change control of a released version is read-only', async ({ browser }) => {
      const page = await openAs(browser, PlatformSettingQaraManager)
      const versionPage = new ProductVersionPage(page)

      await versionPage.open(data.released)
      await versionPage.checkChangeControlIsReadonly(data.releasedChangeControl.label)
      await page.context().close()
    })

    test('Change control is read-only for a Qualified User', async ({ browser }) => {
      const page = await openAs(browser, PlatformSettingThird)
      const versionPage = new ProductVersionPage(page)
      const current = await getVersionChangeControl(clients.user1, data.latest)
      const label = current === data.rightChangeControl._id ? data.rightChangeControl : data.wrongChangeControl

      await versionPage.open(data.latest)
      await versionPage.checkChangeControlIsReadonly(label.label)
      await page.context().close()
    })
  })

  test.describe('Card', () => {
    let data: ChangeControlFixture
    let association: NonNullable<ChangeControlFixture['association']>

    test.beforeAll(async () => {
      data = await prepareCardChangeControl(clients)
      if (data.association === undefined) throw new Error('The card change control needs an association')
      association = data.association
    })

    test('Change control card of the latest version is changed by a QARA', async ({ browser }) => {
      await allure.description('A QARA of the product replaces the wrong change control card of the latest version')
      const page = await openAs(browser, PlatformSettingQaraManager)
      const versionPage = new ProductVersionPage(page)

      await test.step('1. Open the latest version', async () => {
        await versionPage.open(data.latest)
        await versionPage.checkChangeControl(data.wrongChangeControl.label)
      })

      await test.step('2. Select the right change control card', async () => {
        await versionPage.changeChangeControl(data.rightChangeControl.label)
      })

      await test.step('3. The version is linked to the new card only', async () => {
        await expect
          .poll(async () => await getChangeControlCards(clients.user1, association, data.latest))
          .toEqual([data.rightChangeControl._id])
        await versionPage.open(data.latest)
        await versionPage.checkChangeControl(data.rightChangeControl.label)
      })

      await test.step('4. The change control relation is not offered for editing in the Relations block', async () => {
        await expect(page.getByText(data.relationName ?? '', { exact: true })).toHaveCount(0)
      })

      await attachScreenshot('change-control-card-changed.png', page)
      await page.context().close()
    })

    test('Change control card of a released version is read-only', async ({ browser }) => {
      const page = await openAs(browser, PlatformSettingQaraManager)
      const versionPage = new ProductVersionPage(page)

      await versionPage.open(data.released)
      await versionPage.checkChangeControlIsReadonly(data.releasedChangeControl.label)
      expect(await getChangeControlCards(clients.user1, association, data.released)).toEqual([
        data.releasedChangeControl._id
      ])
      await page.context().close()
    })

    test('Change control card is read-only for a Qualified User', async ({ browser }) => {
      const page = await openAs(browser, PlatformSettingThird)
      const versionPage = new ProductVersionPage(page)

      await versionPage.open(data.latest)
      await versionPage.checkChangeControlIsReadonly(data.rightChangeControl.label)
      await page.context().close()
    })
  })
})
