import { type Locator, type Page, expect } from '@playwright/test'
import { CommonPage } from '../common-page'

export class CardsPage extends CommonPage {
  readonly page: Page

  constructor (page: Page) {
    super(page)
    this.page = page
  }

  readonly buttonCardApp = (): Locator => this.page.locator('button[id$="card:string:CardApplication"]')

  // The "All Cards" special navigator item (models/card/src/index.ts, navigatorModel.specials,
  // id: 'all'), rendered by the generic workbench Navigator.svelte the same way as every other
  // app's specials (e.g. tracker's "My issues"), so a plain text lookup inside the navigator
  // panel matches the existing convention (see IssuesPage.myIssuesButton).
  readonly linkAllCards = (): Locator => this.page.locator('.antiPanel-navigator').locator('text="All Cards"')

  // The "+" button in the Card app's navigator header (card.component.CardHeaderButton, wired
  // via workbench.class.Application.navHeaderActions in models/card/src/index.ts). It has no
  // dataId/id of its own, but it is the only <button> rendered inside the current app's
  // ".hulyNavPanel-header" (see NavHeader.svelte), matched here through the existing
  // CommonPage.appHeader() locator. Clicking it opens a Menu popup with "Create Card" and
  // "Create Space" actions - there is no dedicated "New" button on the "All Cards" table view
  // itself (SpecialView.svelte only renders one when createLabel/createComponent/createButton
  // are set, which the "all" special does not do), so this is the only reliable entry point.
  readonly buttonNavHeaderAdd = (): Locator => this.appHeader().locator('button')

  // "Create Space" popup (CreateSpace.svelte, in components/navigator). It reuses the same
  // "teamspace-title" id as the Documents teamspace-creation form.
  readonly inputCardSpaceTitle = (): Locator => this.page.locator('div[id="teamspace-title"] input')

  // "Create Card" popup title field. Depending on whether the target MasterTag has a
  // registered card.mixin.CreateCardExtension, either CreateCardPopupSimple (wrapped in
  // ".antiCard") or CreateCardPopupFull (wrapped in ".hulyModal-container") is shown; both
  // render the same ModernEditbox with label view.string.Title ("Title") as a placeholder.
  readonly inputCardTitle = (): Locator =>
    this.page.locator('.antiCard input[placeholder="Title"], .hulyModal-container input[placeholder="Title"]')

  // Submit button for both the "Create Space" and "Create Card" popups (Card.svelte /
  // Modal.svelte both render a primary button whose visible label is the translated
  // presentation.string.Create, "Create").
  readonly buttonCreateSubmit = (): Locator => this.page.getByRole('button', { name: 'Create', exact: true })

  // Row in the generic Table viewlet (view.viewlet.Table) used by the "All Cards" special
  // view. Mirrors the existing convention in AllProjectsPage (tracker) - Table.svelte binds
  // on:contextmenu directly on each "tr.antiTable-body__row".
  readonly cardRow = (title: string): Locator =>
    this.page.locator('.antiTable-body__row', { has: this.page.locator(`td:has-text("${title}")`) })

  async clickCardApp (): Promise<void> {
    await this.buttonCardApp().click()
  }

  async clickAllCards (): Promise<void> {
    await this.linkAllCards().click()
  }

  // Creates a card.class.CardSpace. A freshly seeded sanity workspace does not provision any
  // CardSpace, and the "Create Card" dialog's SpaceSelector needs a valid space bound before
  // its "Create" button becomes enabled (SpaceSelect auto-selects the first matching space
  // only once one exists), so tests must create one before creating any card.
  async createCardSpace (name: string): Promise<void> {
    await this.buttonNavHeaderAdd().click()
    await this.selectFromDropdown(this.page, 'Create space')
    await expect(this.inputCardSpaceTitle()).toBeVisible()
    await this.inputCardSpaceTitle().fill(name)
    await this.buttonCreateSubmit().click()
    await expect(this.inputCardSpaceTitle()).not.toBeVisible()
  }

  // Creates a card via the navigator header "+" -> "Create Card" flow and waits for the
  // resulting popup to close (CreateCardPopup dispatches 'close' with the new card id, which
  // CardHeaderButton.svelte's handleCreateCard callback uses to navigate straight into the new
  // card's edit panel).
  async createCard (title: string): Promise<void> {
    await this.buttonNavHeaderAdd().click()
    await this.selectFromDropdown(this.page, 'Create Card')
    await expect(this.inputCardTitle()).toBeVisible()
    await this.inputCardTitle().fill(title)
    await expect(this.buttonCreateSubmit()).toBeEnabled({ timeout: 15000 })
    await this.buttonCreateSubmit().click()
    await expect(this.inputCardTitle()).not.toBeVisible()
  }

  // Mirrors IssuesPage.doActionOnIssue - right-clicking a single, unchecked table row passes
  // just that row's document to the context menu (Table.svelte's showContextMenu clears any
  // stale selection when the clicked row isn't already checked), so no checkbox interaction is
  // required beforehand.
  async doActionOnCard (title: string, action: string): Promise<void> {
    await this.cardRow(title).click({ button: 'right' })
    await this.selectFromDropdown(this.page, action)
  }

  // Opens a card from the "All Cards" table (CardPresenter.svelte renders the title through
  // DocNavLink, i.e. an <a> element).
  async openCard (title: string): Promise<void> {
    await this.cardRow(title).locator('a', { hasText: title }).click()
  }
}
