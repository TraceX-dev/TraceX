import { test, expect } from '@playwright/test'
import { generateId, PlatformSetting, PlatformURI } from '../utils'
import { CardsPage } from '../model/card/cards-page'
import { CardContentPage } from '../model/card/card-content-page'

test.use({
  storageState: PlatformSetting
})

test.describe('Copy as Markdown Table tests', () => {
  let cardsPage: CardsPage
  let cardContentPage: CardContentPage

  test.beforeEach(async ({ page }) => {
    cardsPage = new CardsPage(page)
    cardContentPage = new CardContentPage(page)

    await page.goto(`${PlatformURI}/workbench/sanity-ws`)
    await cardsPage.clickCardApp()
    await cardsPage.clickAllCards()
  })

  test('Copy as Markdown Table pastes as a real table, not raw markdown text', async ({ page, context }) => {
    // playwright.config.ts already grants these globally for the "Platform" project, but the
    // grant is re-asserted here since this spec is the first to rely on a full clipboard
    // write+read+paste round trip rather than just navigator.clipboard.readText().
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    const spaceName = `Markdown Table Space-${generateId()}`
    const sourceCardTitle = `Copy Table Card-${generateId()}`
    const targetCardTitle = `Paste Table Card-${generateId()}`

    await test.step('Create a card space and two cards', async () => {
      // A fresh sanity workspace does not seed any card.class.CardSpace, and the "Create Card"
      // dialog needs a valid space bound before its "Create" button is enabled, so create one
      // up front and reuse it for both cards.
      await cardsPage.createCardSpace(spaceName)

      await cardsPage.createCard(sourceCardTitle)
      await cardContentPage.checkCardTitle(sourceCardTitle)

      await cardsPage.clickAllCards()
      await cardsPage.createCard(targetCardTitle)
      await cardContentPage.checkCardTitle(targetCardTitle)

      await cardsPage.clickAllCards()
    })

    await test.step('Copy the source card as a Markdown table', async () => {
      await cardsPage.doActionOnCard(sourceCardTitle, 'Copy as Markdown Table')

      // Sanity check of the *copy* side, independent of the paste side: copyMarkdown() in
      // plugins/view-resources/src/actionImpl.ts only ever writes a "text/plain" clipboard
      // entry (browsers reject "text/markdown"/custom MIME types in ClipboardItem), containing
      // the markdown table plus a trailing metadata HTML comment. If the copy action stopped
      // producing a real markdown table, the paste-side assertions below would be meaningless,
      // so this is checked first and on its own.
      const clipboardText = await page.evaluate(async () => await navigator.clipboard.readText())
      expect(clipboardText).toContain(sourceCardTitle)
      expect(clipboardText).toContain('|')
      expect(clipboardText).toContain('---')
    })

    await test.step('Paste the copied table into another card and verify it renders as a real table', async () => {
      await cardsPage.clickAllCards()
      await cardsPage.openCard(targetCardTitle)
      await cardContentPage.checkCardTitle(targetCardTitle)

      await cardContentPage.focusContentEditor()
      await cardContentPage.pasteFromClipboard()

      // REGRESSION GUARD - this is the entire point of the test.
      //
      // plugins/text-editor-resources/src/components/extension/shortcuts/smartPaste.ts
      // intercepts the paste, converts the clipboard's markdown to a ProseMirror document via
      // markdownToMarkup(), and only replaces the browser's default paste with that real node
      // when shouldUseMarkdownOutput() finds an "important" node type - "table" is one of the
      // importantMarkupNodeTypes. If that detection, or the markdown -> markup conversion of
      // the table itself, ever regresses, handlePaste() returns false and the browser falls
      // back to inserting the clipboard's raw "text/plain" payload as an ordinary paragraph:
      // the pipe-delimited "| Header | ... |" / "| --- | ... |" markdown lines would show up
      // as literal, unrendered text instead of an actual <table>.
      //
      // Positive assertion: a real <table class="proseTable"> appeared, and one of its cells
      // contains the source card's title (proving the pasted content is the table we copied,
      // not some unrelated fallback content).
      await expect(cardContentPage.proseTable()).toBeVisible({ timeout: 15000 })
      await expect(cardContentPage.proseTable().locator('td', { hasText: sourceCardTitle }).first()).toBeVisible()

      // Negative assertion: this is what the regression looks like in the DOM - the table
      // markdown (header/separator row, e.g. "| --- | --- |") and the metadata HTML comment
      // rendered as plain, literal text content inside the editor instead of being parsed away
      // into real table/comment-free nodes.
      const editorText = (await cardContentPage.contentEditor().textContent()) ?? ''
      expect(editorText).not.toMatch(/\|\s*-{3,}\s*\|/)
      expect(editorText).not.toContain('<!--')
    })
  })
})
