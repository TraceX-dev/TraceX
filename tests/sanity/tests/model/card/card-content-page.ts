import { type Locator, type Page, expect } from '@playwright/test'
import { CommonPage } from '../common-page'

export class CardContentPage extends CommonPage {
  readonly page: Page

  constructor (page: Page) {
    super(page)
    this.page = page
  }

  // The card title is edited via an EditBox rendered in slot="title" of EditCardNew.svelte,
  // which Panel places inside the header element with class "hulyHeader-titleGroup" (see
  // EditCardNew.svelte's afterUpdate(), which queries `element.querySelector('.hulyHeader-
  // titleGroup')` for that same element). Unlike Documents (whose title lives inside
  // "div[class*='main-content']"), Card's ".main-content" div only wraps the card body/content
  // editor (EditCardNewContent), not the title.
  readonly inputCardTitle = (): Locator => this.page.locator('.hulyHeader-titleGroup div.title input')

  // The card's main "content" editor (Description.svelte -> ContentEditor.svelte ->
  // CollaboratorEditor -> CollaborativeTextEditor), scoped to two things:
  //  - ".main-content" (EditCardNew.svelte), the card body wrapper - both the content editor
  //    and the comments editor (MessageInput, rendered in a sibling ".message-input" div by
  //    EditCardNewContent.svelte) live inside it, so this alone would not disambiguate them.
  //  - ".textInput" (CollaborativeTextEditor.svelte), which is only rendered by the
  //    Collaborator/CollaborativeTextEditor stack used for the card's content attribute.
  //    MessageInput instead renders communication-resources/TextInput.svelte, which uses the
  //    plain text-editor-resources TextEditor.svelte - that component does NOT render a
  //    ".textInput" wrapper (only a bare ".select-text" div), so this selector cannot
  //    accidentally match the comments box.
  readonly contentEditor = (): Locator => this.page.locator('.main-content .textInput div.tiptap')

  // All rich-text editors in this app share the same Tiptap kit (text-editor-resources/src/
  // kits/editor-kit.ts), which renders <table> nodes with HTMLAttributes class "proseTable" -
  // this mirrors the existing convention in
  // tests/sanity/tests/model/documents/document-content-page.ts (proseTableCell), so it is not
  // Card-specific and stays valid even if Card's own DOM nesting changes.
  readonly proseTable = (): Locator => this.contentEditor().locator('table.proseTable')

  async checkCardTitle (title: string): Promise<void> {
    await expect(this.inputCardTitle()).toHaveValue(title)
  }

  async focusContentEditor (): Promise<void> {
    await this.contentEditor().click()
  }

  // Pastes whatever is currently on the (fake, per-context) clipboard. Chromium's async
  // Clipboard API shares its per-context clipboard with native paste events, and
  // tests/sanity/tests/playwright.config.ts already grants clipboard-read/clipboard-write
  // permissions globally, so a real keyboard paste exercises the same handlePaste() code path
  // (plugins/text-editor-resources/src/components/extension/shortcuts/smartPaste.ts) that a
  // user's Ctrl/Cmd+V would.
  async pasteFromClipboard (): Promise<void> {
    await this.page.keyboard.press('ControlOrMeta+KeyV')
  }
}
