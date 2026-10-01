/**

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
*/

import core, {
  AccountRole,
  type AccountUuid,
  type Class,
  type Data,
  type Doc,
  type Ref,
  type Space
} from '@hcengineering/core'
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { type WorkspaceRestClient } from '../API/WorkspaceRestClient'
import { ChannelPage } from '../model/channel-page'
import { SpotlightPopup } from '../model/spotlight-popup'
import { IssuesPage } from '../model/tracker/issues-page'
import { NewProjectPage } from '../model/tracker/new-project-page'
import { TrackerNavigationMenuPage } from '../model/tracker/tracker-navigation-menu-page'
import { generateProjectId } from '../tracker/tracker.utils'
import { generateId, generateUser, PlatformURI, PlatformWs, setTestOptions } from '../utils'
import {
  connectOwnerRest,
  connectRest,
  createWorkspaceMember,
  loginAs,
  newIssueButton,
  openAsOwner,
  withRequest,
  type OpenedPage
} from './guest-utils'

// Class ids are spelled out: the sanity tests do not depend on the tracker, chunter and contact plugins.
const CHANNEL = 'chunter:class:Channel' as Ref<Class<Space>>
const PERSON = 'contact:class:Person' as Ref<Class<PersonDoc>>
const CARD_SPACE = 'card:class:CardSpace' as Ref<Class<Space>>
const CARD_SPACE_TYPE = 'card:spaceType:SpaceType'
const CARD_TYPE = 'card:types:Document' as Ref<Class<Doc>>

interface PersonDoc extends Doc {
  name: string
  personUuid?: AccountUuid
}

// Employees of the sanity-ws dump.
// PlatformUser: creates all spaces, so it is a member of every space of the guest.
const OWNER_NAME = 'Appleseed John'
// Shares only space B with the guest: visible to the guest (server), but not relevant in space A (client).
const B_ONLY_NAME = 'Chen Rosamund'

// The mention popup searches asynchronously; give a negative check time to settle.
const SEARCH_SETTLE_MS = 1000

/**
 * Guests see people of all their spaces (server, see guest-person-visibility.spec.ts), but pickers and mentions
 * only offer people related to the current space. Every test has a guest in two spaces: A (owner + guest) and
 * B (owner + guest + B_ONLY_NAME). A person of B must not be offered in A, while it is still offered in B
 * and found by spotlight: that proves the narrowing comes from the space context, not from the server.
 */
test.describe('Guest people scoped to the space', () => {
  test.describe.configure({ mode: 'serial' })

  const guest = generateUser()
  const guestName = `${guest.lastName} ${guest.firstName}`

  const projectA = `ScopeA-${generateProjectId()}`
  const projectB = `ScopeB-${generateProjectId()}`

  let channelA: Ref<Space>
  let channelB: Ref<Space>
  let cardA: Ref<Doc>
  let cardB: Ref<Doc>

  test.beforeAll(async ({ browser, playwright }) => {
    // A member and two projects through the UI: more than a single test budget.
    test.setTimeout(300_000)

    await createWorkspaceMember(playwright, browser, guest, AccountRole.Guest)

    const owner = await openAsOwner(browser)
    try {
      const navigation = new TrackerNavigationMenuPage(owner.page)
      for (const [title, members] of [
        [projectA, [guestName]],
        [projectB, [guestName, B_ONLY_NAME]]
      ] as const) {
        await navigation.pressCreateProjectButton()
        await new NewProjectPage(owner.page).createNewProject({
          title,
          identifier: generateProjectId(),
          description: 'Private project for guest scoped people tests',
          private: true,
          members: [...members]
        })
        await navigation.checkProjectExist(title)
      }
    } finally {
      await owner.context.close()
    }

    await withRequest(playwright, async (request) => {
      const owner = await connectOwnerRest(request)
      const guestRest = await connectRest(request, guest)
      const guestAccount = guestRest.account.uuid
      const bOnlyAccount = await findAccountByName(owner, B_ONLY_NAME)

      channelA = await createPrivateChannel(owner, `scope-a-${generateId(6)}`, [guestAccount])
      channelB = await createPrivateChannel(owner, `scope-b-${generateId(6)}`, [guestAccount, bOnlyAccount])

      // A guest may edit only its own cards, so the guest creates them (allowed by the Card module guest policy).
      const cardSpaceA = await createPrivateCardSpace(owner, `Scope A ${generateId(6)}`, [guestAccount])
      const cardSpaceB = await createPrivateCardSpace(owner, `Scope B ${generateId(6)}`, [guestAccount, bOnlyAccount])
      cardA = await createCard(guestRest, cardSpaceA, `Guest card A ${generateId(6)}`)
      cardB = await createCard(guestRest, cardSpaceB, `Guest card B ${generateId(6)}`)
    })
  })

  async function findAccountByName (client: WorkspaceRestClient, name: string): Promise<AccountUuid> {
    // Person names are stored as "Last,First" and shown as "Last First".
    const persons = await client.findAll(PERSON, {})
    const person = persons.find((it) => it.name.split(',').join(' ') === name && it.personUuid !== undefined)
    if (person?.personUuid === undefined) throw new Error(`Account of "${name}" is not found`)
    return person.personUuid
  }

  async function createPrivateChannel (
    owner: WorkspaceRestClient,
    name: string,
    members: AccountUuid[]
  ): Promise<Ref<Space>> {
    const tx = owner.factory.createTxCreateDoc(CHANNEL, core.space.Space, {
      name,
      description: '',
      topic: '',
      private: true,
      archived: false,
      members: [owner.account.uuid, ...members],
      owners: [owner.account.uuid]
    } as unknown as Data<Space>)
    expect(await owner.tx(tx), `create channel ${name}`).toMatchObject({ ok: true })
    return tx.objectId
  }

  async function createPrivateCardSpace (
    owner: WorkspaceRestClient,
    name: string,
    members: AccountUuid[]
  ): Promise<Ref<Space>> {
    const tx = owner.factory.createTxCreateDoc(CARD_SPACE, core.space.Space, {
      name,
      description: '',
      private: true,
      archived: false,
      members: [owner.account.uuid, ...members],
      owners: [owner.account.uuid],
      type: CARD_SPACE_TYPE,
      types: [CARD_TYPE]
    } as unknown as Data<Space>)
    expect(await owner.tx(tx), `create card space ${name}`).toMatchObject({ ok: true })
    return tx.objectId
  }

  /** Same data as `createCard` of card-resources with an empty content. */
  async function createCard (client: WorkspaceRestClient, space: Ref<Space>, title: string): Promise<Ref<Doc>> {
    const tx = client.factory.createTxCreateDoc(CARD_TYPE, space, {
      title,
      content: '',
      blobs: {},
      parentInfo: [],
      rank: ''
    })
    expect(await client.tx(tx), `create card ${title} as ${client.account.primarySocialId}`).toMatchObject({
      ok: true
    })
    return tx.objectId
  }

  async function openTrackerAsGuest (browser: Browser): Promise<OpenedPage> {
    const { page, context } = await loginAs(browser, guest)
    await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}/tracker`))?.finished()
    await setTestOptions(page)
    await expect(newIssueButton(page)).toBeVisible()
    return { page, context }
  }

  /**
   * Opens a card of the guest and returns its description editor (collaborative, the people scope comes from
   * the space of the card and its collaborators).
   */
  async function openCardAsGuest (browser: Browser, cardId: Ref<Doc>): Promise<OpenedPage & { description: Locator }> {
    const { page, context } = await loginAs(browser, guest)
    await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}/card/${cardId}`))?.finished()
    await setTestOptions(page)
    const description = page.locator('div.popupPanel-body div.textInput div.tiptap[contenteditable="true"]').first()
    await expect(description).toBeVisible()
    return { page, context, description }
  }

  async function openChannelAsGuest (browser: Browser, channel: Ref<Space>): Promise<OpenedPage> {
    const { page, context } = await loginAs(browser, guest)
    const location = encodeURIComponent(`${channel}|${CHANNEL}`)
    await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}/chunter/${location}`))?.finished()
    await setTestOptions(page)
    await expect(new ChannelPage(page).inputMessage()).toBeVisible()
    return { page, context }
  }

  /**
   * Types a mention of the owner (positive check, the popup works) and then of the B-only person.
   * The input is cleared before each mention: replacing one mention query with another in a single `fill`
   * closes the mention popup and does not open it again.
   */
  async function checkMentions (page: Page, input: () => Locator, bOnlyOffered: boolean): Promise<void> {
    const issuesPage = new IssuesPage(page)

    await typeMention(page, input, OWNER_NAME)
    await expect(issuesPage.mentionPopupListItem(OWNER_NAME).first()).toBeVisible()

    await typeMention(page, input, B_ONLY_NAME)
    if (bOnlyOffered) {
      await expect(issuesPage.mentionPopupListItem(B_ONLY_NAME).first()).toBeVisible()
    } else {
      // The popup must be open, otherwise the negative check below proves nothing.
      await expect(mentionPopup(page)).toBeVisible()
      await page.waitForTimeout(SEARCH_SETTLE_MS)
      await expect(issuesPage.mentionPopupListItem(B_ONLY_NAME)).toHaveCount(0)
    }
    await input().fill('')
  }

  async function typeMention (page: Page, input: () => Locator, name: string): Promise<void> {
    await input().fill('')
    await expect(mentionPopup(page)).toHaveCount(0)
    await input().fill(`@${name.split(' ')[0]}`)
  }

  function mentionPopup (page: Page): Locator {
    return page.locator('form.mentionPoup')
  }

  test('Mentions in a new issue follow the selected project', async ({ browser }) => {
    const { page, context } = await openTrackerAsGuest(browser)
    try {
      await newIssueButton(page).click()
      const issuesPage = new IssuesPage(page)
      const description = (): Locator => issuesPage.inputPopupCreateNewIssueDescription()

      await issuesPage.buttonPopupCreateNewIssueProject().click()
      await issuesPage.selectMenuItem(page, projectA, true)
      await checkMentions(page, description, false)

      // The editor is not recreated on project change: the people scope must follow the selected project.
      await issuesPage.buttonPopupCreateNewIssueProject().click()
      await issuesPage.selectMenuItem(page, projectB, true)
      await checkMentions(page, description, true)
    } finally {
      await context.close()
    }
  })

  test('Mentions in a card description are limited to the card space', async ({ browser }) => {
    const a = await openCardAsGuest(browser, cardA)
    try {
      await checkMentions(a.page, () => a.description, false)

      // The person is still visible to the guest (they share space B), only not offered in space A.
      const spotlight = new SpotlightPopup(a.page)
      await spotlight.open()
      await spotlight.fillSearchInput(B_ONLY_NAME)
      await expect(spotlight.searchResult(B_ONLY_NAME).first()).toBeVisible()
    } finally {
      await a.context.close()
    }

    const b = await openCardAsGuest(browser, cardB)
    try {
      await checkMentions(b.page, () => b.description, true)
    } finally {
      await b.context.close()
    }
  })

  test('Mentions in a chat channel are limited to the channel members', async ({ browser }) => {
    const a = await openChannelAsGuest(browser, channelA)
    try {
      await checkMentions(a.page, () => new ChannelPage(a.page).inputMessage(), false)
    } finally {
      await a.context.close()
    }

    const b = await openChannelAsGuest(browser, channelB)
    try {
      await checkMentions(b.page, () => new ChannelPage(b.page).inputMessage(), true)
    } finally {
      await b.context.close()
    }
  })
})
