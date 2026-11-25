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
import { expect, test, type Locator } from '@playwright/test'
import { DocumentURI, generateId, HomepageURI, PlatformSetting, PlatformURI } from '../utils'
import type { NewDocument, NewTemplate } from '../model/types'
import { DocumentContentPage } from '../model/documents/document-content-page'
import { NavigationMenuPage } from '../model/documents/navigation-menu-page'
import { TemplatesPage } from '../model/documents/templates-page'
import { prepareDocumentStep } from './common-documents-steps'

interface TableSource {
  path: string
  title: string
  columns: string[]
}

interface ColumnValue {
  header: string
  value: string
}

test.use({ storageState: PlatformSetting })

test('QMS. Library and Templates table copies retain their column values when pasted', async ({ page }) => {
  test.setTimeout(120_000)
  const id = generateId(6)
  const template: NewTemplate = {
    title: `Clipboard template ${id}`,
    description: 'Source for the template table copy regression',
    code: `CP${id}`,
    docPrefix: `CP${id}`,
    category: 'Document-Control',
    location: { space: 'Quality documents', parent: 'Quality documents' }
  }
  const document: NewDocument = {
    template: 'HR (HR)',
    title: `Clipboard document ${id}`,
    description: 'Destination and source for the document table copy regression'
  }
  const content = new DocumentContentPage(page)

  await test.step('Create an isolated template and destination document', async () => {
    await page.goto(`${PlatformURI}/${HomepageURI}`)
    const clipboardAvailable = await page.evaluate(
      () => window.isSecureContext && typeof navigator.clipboard?.readText === 'function'
    )
    expect(clipboardAvailable, 'Clipboard tests require a secure context and the browser Clipboard API').toBe(true)
    await new NavigationMenuPage(page).buttonTemplates.click()
    const templates = new TemplatesPage(page)
    await templates.buttonCreateTemplate.click()
    await templates.createTemplate(template)
    await content.checkDocumentTitle(template.title)

    await prepareDocumentStep(page, document)
    await content.checkDocumentTitle(document.title)
  })
  const destinationUrl = page.url()
  const sources: TableSource[] = [
    {
      path: 'library?mode=all',
      title: document.title,
      columns: ['ID', 'Title', 'Status', 'Version', 'Space', 'Category', 'Template', 'Template version']
    },
    {
      path: 'templates',
      title: template.title,
      columns: ['ID', 'Title', 'Status', 'Version', 'Documents prefix', 'Category', 'Space']
    }
  ]

  async function columnValues (table: Locator, row: Locator, columns: string[]): Promise<ColumnValue[]> {
    const headers = (await table.locator('thead th').allTextContents()).map((text) => text.trim())
    const values: ColumnValue[] = []
    for (const header of columns) {
      const index = headers.findIndex((text) => text.toLowerCase() === header.toLowerCase())
      expect(index, `The source table must have a ${header} column`).toBeGreaterThanOrEqual(0)
      const cell = row.locator('td').nth(index)
      await expect(cell, `The source ${header} must be populated`).not.toHaveText(/^\s*$/)
      values.push({ header, value: (await cell.innerText()).trim() })
    }
    return values
  }

  for (const source of sources) {
    await test.step(`Copy ${source.path} through the browser clipboard and verify the pasted columns`, async () => {
      await page.goto(`${PlatformURI}/${DocumentURI}/${source.path}`)
      const search = page.locator('.searchInput-wrapper')
      await search.click()
      await search.locator('input').fill(source.title)
      await search.locator('input').press('Enter')
      const sourceTable = page.locator('table.antiTable')
      const sourceRows = sourceTable.locator('tbody tr.antiTable-body__row')
      await expect(sourceRows).toHaveCount(1)
      await expect(sourceRows).toContainText(source.title)
      const values = await columnValues(sourceTable, sourceRows, source.columns)
      expect(values.find((column) => column.header === 'Title')?.value).toBe(source.title)

      // Keep the whole-view scope to cover the Templates lookup resolution failure.
      await page.locator('[data-id="btnCopyTable"]').click()
      const dialog = page.locator('div.antiPopup').filter({
        has: page.getByRole('button', { name: 'Copy to clipboard', exact: true })
      })
      await dialog.locator('div.control').nth(0).locator('button').click()
      await page.locator('div.selectPopup button.menu-item', { hasText: 'TraceX table — can be refreshed' }).click()
      await dialog.getByRole('button', { name: 'Copy to clipboard', exact: true }).click()
      // A failed copy leaves the dialog open with the unavailable-column error.
      await expect(dialog).toBeHidden()
      const clipboard = await page.evaluate(async () => await navigator.clipboard.readText())
      expect(clipboard).toContain(source.title)

      await page.goto(destinationUrl)
      const editor = content.contentLocator
      await expect(editor).toHaveJSProperty('contentEditable', 'true')
      // Each source starts in a paragraph, so the next paste cannot land inside the previous table.
      await content.replaceContent('Clipboard regression target')
      await editor.click()
      await editor.press('ControlOrMeta+End')
      await editor.press('ControlOrMeta+V')
      // TableNodeView also renders a hidden print copy; inspect the interactive table only.
      const pasted = editor.locator('.table-scroller > table.proseTable')
      await expect(pasted).toHaveCount(1)
      const pastedHeaders = (await pasted.locator('tr').first().locator('th, td').allTextContents()).map((text) =>
        text.trim().toLowerCase()
      )
      const pastedRows = pasted.locator('tr').filter({ hasText: source.title })
      await expect(pastedRows).toHaveCount(1)
      for (const { header, value } of values) {
        const index = pastedHeaders.indexOf(header.toLowerCase())
        expect(index, `The pasted table must retain the ${header} column`).toBeGreaterThanOrEqual(0)
        // Document states are serialized as enum values (e.g. draft), while the view capitalizes them.
        await expect(pastedRows.locator('td').nth(index)).toHaveText(value, { ignoreCase: header === 'Status' })
      }
    })
  }
})
