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
  type AttachedDoc,
  type Class,
  type Data,
  type Ref,
  type Space
} from '@hcengineering/core'
import { expect, test, type Locator, type Page, type PlaywrightWorkerArgs } from '@playwright/test'
import { type WorkspaceRestClient } from '../API/WorkspaceRestClient'
import { ChannelPage } from '../model/channel-page'
import { type SignUpData } from '../model/common-types'
import { EditProjectPage } from '../model/tracker/edit-project-page'
import { NewProjectPage } from '../model/tracker/new-project-page'
import { TrackerNavigationMenuPage } from '../model/tracker/tracker-navigation-menu-page'
import { generateProjectId } from '../tracker/tracker.utils'
import { generateId, generateUser, PlatformURI, PlatformWs, setTestOptions } from '../utils'
import {
  connectOwnerRest,
  connectRest,
  createWorkspaceMember,
  loginAs,
  markup,
  openAsOwner,
  type OpenedPage,
  withRequest
} from '../guest/guest-utils'

// Class ids are spelled out: the sanity tests do not depend on the tracker and chunter plugins.
const CHANNEL = 'chunter:class:Channel' as Ref<Class<Space>>
const CHAT_MESSAGE = 'chunter:class:ChatMessage' as Ref<Class<MessageDoc>>
const PROJECT = 'tracker:class:Project' as Ref<Class<Space>>

interface MessageDoc extends AttachedDoc {
  message: string
}

// Collaborators follow members in an async trigger, and a guest reads the messages of a space while being
// a collaborator: revocation of message access is eventual, give it time.
const REVOKE_TIMEOUT = 15_000

/**
 * UI paths that change Space.members, checked against the stored `members` and the server-side access of the
 * affected account. Pins the current behavior before user groups make `members` a computed field.
 */
test.describe('Space members', () => {
  test.describe.configure({ mode: 'serial' })

  const member = generateUser()
  const memberName = `${member.lastName} ${member.firstName}`
  const guest = generateUser()
  const guestName = `${guest.lastName} ${guest.firstName}`

  let memberAccount: AccountUuid
  let guestAccount: AccountUuid

  test.beforeAll(async ({ browser, playwright }) => {
    // Two members through sign-up and the first workbench connect: more than a single test budget.
    test.setTimeout(300_000)

    await createWorkspaceMember(playwright, browser, member, AccountRole.User)
    await createWorkspaceMember(playwright, browser, guest, AccountRole.Guest)

    await withRequest(playwright, async (request) => {
      memberAccount = (await connectRest(request, member)).account.uuid
      guestAccount = (await connectRest(request, guest)).account.uuid
    })
  })

  // ------------------------------------------------------------------ helpers

  interface Channel {
    id: Ref<Space>
    name: string
    message: string
  }

  /** A channel of the owner with one message; `members` are added to the owner. */
  async function createChannel (
    owner: WorkspaceRestClient,
    members: AccountUuid[],
    isPrivate: boolean = true
  ): Promise<Channel> {
    const name = `members-${generateId(6)}`
    const create = owner.factory.createTxCreateDoc(CHANNEL, core.space.Space, {
      name,
      description: '',
      topic: '',
      private: isPrivate,
      archived: false,
      members: [owner.account.uuid, ...members],
      owners: [owner.account.uuid]
    } as unknown as Data<Space>)
    expect(await owner.tx(create), `create channel ${name}`).toMatchObject({ ok: true })

    const text = `Members probe ${generateId(8)}`
    const message = owner.factory.createTxCollectionCUD(
      CHANNEL,
      create.objectId,
      create.objectId,
      'messages',
      owner.factory.createTxCreateDoc(CHAT_MESSAGE, create.objectId, {
        message: markup(text),
        attachments: 0
      } as unknown as Data<MessageDoc>)
    )
    expect(await owner.tx(message), `post to channel ${name}`).toMatchObject({ ok: true })
    return { id: create.objectId, name, message: text }
  }

  async function updateMembers (
    owner: WorkspaceRestClient,
    channel: Ref<Space>,
    operations: Record<string, any>
  ): Promise<void> {
    const tx = owner.factory.createTxUpdateDoc(CHANNEL, core.space.Space, channel, operations)
    expect(await owner.tx(tx), `update members of ${channel}`).toMatchObject({ ok: true })
  }

  async function storedMembers (
    owner: WorkspaceRestClient,
    _class: Ref<Class<Space>>,
    space: Ref<Space>
  ): Promise<AccountUuid[]> {
    return (await owner.findOne(_class, { _id: space }))?.members ?? []
  }

  /** Whether the client reads the space and the messages in it; both must agree. */
  async function readsChannel (client: WorkspaceRestClient, channel: Ref<Space>): Promise<boolean> {
    const seesSpace = (await client.findAll(CHANNEL, { _id: channel })).length > 0
    const seesMessages = (await client.findAll(CHAT_MESSAGE, { space: channel })).length > 0
    expect({ seesSpace, seesMessages }, `space and messages access of ${client.account.uuid}`).toEqual({
      seesSpace,
      seesMessages: seesSpace
    })
    return seesSpace
  }

  /** Waits until the access of every client settles to the expected one. */
  async function expectReads (
    playwright: PlaywrightWorkerArgs['playwright'],
    channel: Ref<Space>,
    expected: Array<[SignUpData, boolean]>
  ): Promise<void> {
    await withRequest(playwright, async (request) => {
      for (const [user, reads] of expected) {
        const client = await connectRest(request, user)
        await expect.poll(async () => await readsChannel(client, channel), { timeout: REVOKE_TIMEOUT }).toBe(reads)
      }
    })
  }

  function channelUrl (channel: Ref<Space>): string {
    return `${PlatformURI}/workbench/${PlatformWs}/chunter/${encodeURIComponent(`${channel}|${CHANNEL}`)}`
  }

  async function openChannel (opened: OpenedPage, channel: Channel): Promise<ChannelPage> {
    await (await opened.page.goto(channelUrl(channel.id)))?.finished()
    await setTestOptions(opened.page)
    const channelPage = new ChannelPage(opened.page)
    await expect(channelPage.textMessage(channel.message)).toBeVisible()
    return channelPage
  }

  /** Row of a person in the members list of the channel aside. */
  function memberRow (page: Page, name: string): Locator {
    return page.locator('.members .item', { hasText: name })
  }

  // ------------------------------------------------------------------ channel aside (owner)

  test('Adding a member in the channel aside grants access', async ({ browser, playwright }) => {
    const channel = await withRequest(
      playwright,
      async (request) => await createChannel(await connectOwnerRest(request), [])
    )
    await expectReads(playwright, channel.id, [[member, false]])

    const owner = await openAsOwner(browser)
    try {
      const channelPage = await openChannel(owner, channel)
      await channelPage.clickOnOpenChannelDetails()
      await owner.page.getByRole('button', { name: 'Add members' }).click()
      // SelectUsersPopup: a search box and one button per user ("<initials> <name>"), not a selectPopup list.
      await owner.page.getByPlaceholder('Search...', { exact: true }).fill(member.lastName)
      const userButton = owner.page.getByRole('button', { name: memberName })
      await userButton.click()
      await expect(userButton.getByRole('checkbox')).toBeChecked()
      await owner.page.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(memberRow(owner.page, memberName)).toBeVisible()
    } finally {
      await owner.context.close()
    }

    await withRequest(playwright, async (request) => {
      const ownerRest = await connectOwnerRest(request)
      await expect.poll(async () => await storedMembers(ownerRest, CHANNEL, channel.id)).toContain(memberAccount)
    })
    await expectReads(playwright, channel.id, [[member, true]])
  })

  test('Removing a member in the channel aside revokes access', async ({ browser, playwright }) => {
    const channel = await withRequest(
      playwright,
      async (request) => await createChannel(await connectOwnerRest(request), [memberAccount, guestAccount])
    )
    await expectReads(playwright, channel.id, [
      [member, true],
      [guest, true]
    ])

    const owner = await openAsOwner(browser)
    try {
      const channelPage = await openChannel(owner, channel)
      await channelPage.clickOnOpenChannelDetails()
      for (const name of [memberName, guestName]) {
        const row = memberRow(owner.page, name)
        await row.hover()
        await row.locator('.item__action button').click()
        await expect(row).toBeHidden()
      }
    } finally {
      await owner.context.close()
    }

    await withRequest(playwright, async (request) => {
      const ownerRest = await connectOwnerRest(request)
      await expect
        .poll(async () => await storedMembers(ownerRest, CHANNEL, channel.id))
        .toEqual([ownerRest.account.uuid])
    })
    await expectReads(playwright, channel.id, [
      [member, false],
      [guest, false]
    ])
  })

  // ------------------------------------------------------------------ leave / join (member)

  test('A member leaves a channel from the navigator and joins it back from the channel browser', async ({
    browser,
    playwright
  }) => {
    const channel = await withRequest(
      playwright,
      async (request) => await createChannel(await connectOwnerRest(request), [memberAccount], false)
    )

    const opened = await loginAs(browser, member)
    try {
      const channelPage = await openChannel(opened, channel)

      await channelPage.makeActionWithChannelInMenu(channel.name, 'Leave channel')
      await expect(channelPage.chooseChannel(channel.name)).toBeHidden()
      await withRequest(playwright, async (request) => {
        const ownerRest = await connectOwnerRest(request)
        await expect.poll(async () => await storedMembers(ownerRest, CHANNEL, channel.id)).not.toContain(memberAccount)
      })

      await channelPage.clickChannelTab()
      await channelPage.searchChannel(channel.name)
      await channelPage.checkIfChannelTableExist(channel.name, true)
      await channelPage
        .channelTable()
        .getByRole('row', { name: channel.name })
        .getByRole('button', { name: 'Join' })
        .click()
      await expect(channelPage.chooseChannel(channel.name)).toBeVisible()
      await withRequest(playwright, async (request) => {
        const ownerRest = await connectOwnerRest(request)
        await expect.poll(async () => await storedMembers(ownerRest, CHANNEL, channel.id)).toContain(memberAccount)
      })
    } finally {
      await opened.context.close()
    }
  })

  // ------------------------------------------------------------------ guest in an open session

  test('A guest loses a channel in an open session when removed', async ({ browser, playwright }) => {
    const channel = await withRequest(
      playwright,
      async (request) => await createChannel(await connectOwnerRest(request), [guestAccount])
    )

    const opened = await loginAs(browser, guest)
    try {
      const channelPage = await openChannel(opened, channel)
      await expect(channelPage.chooseChannel(channel.name)).toBeVisible()

      await withRequest(playwright, async (request) => {
        await updateMembers(await connectOwnerRest(request), channel.id, { $pull: { members: guestAccount } })
      })

      // No reload: the open session must drop the channel and its messages.
      await expect(channelPage.chooseChannel(channel.name)).toBeHidden({ timeout: REVOKE_TIMEOUT })
      await expect(channelPage.textMessage(channel.message)).toBeHidden({ timeout: REVOKE_TIMEOUT })
    } finally {
      await opened.context.close()
    }
    await expectReads(playwright, channel.id, [[guest, false]])
  })

  test('A guest gets a channel in an open session when added', async ({ browser, playwright }) => {
    const channel = await withRequest(
      playwright,
      async (request) => await createChannel(await connectOwnerRest(request), [])
    )

    const opened = await loginAs(browser, guest)
    try {
      await (await opened.page.goto(`${PlatformURI}/workbench/${PlatformWs}/chunter`))?.finished()
      await setTestOptions(opened.page)
      const channelPage = new ChannelPage(opened.page)
      await expect(channelPage.chooseChannel(channel.name)).toBeHidden()

      await withRequest(playwright, async (request) => {
        await updateMembers(await connectOwnerRest(request), channel.id, { $push: { members: guestAccount } })
      })

      // No reload: the channel appears and opens with its messages.
      await channelPage.clickChooseChannel(channel.name)
      await expect(channelPage.textMessage(channel.message)).toBeVisible()
    } finally {
      await opened.context.close()
    }
    await expectReads(playwright, channel.id, [[guest, true]])
  })

  // ------------------------------------------------------------------ project (full replacement of members)

  test('Removing a guest from a private project in Edit project revokes access', async ({ browser, playwright }) => {
    // Edit project saves `members` as a whole array, unlike the channel aside ($push / $pull).
    const title = `Members-${generateProjectId()}`

    const owner = await openAsOwner(browser)
    try {
      await (await owner.page.goto(`${PlatformURI}/workbench/${PlatformWs}/tracker`))?.finished()
      const navigation = new TrackerNavigationMenuPage(owner.page)
      await navigation.pressCreateProjectButton()
      await new NewProjectPage(owner.page).createNewProject({
        title,
        identifier: generateProjectId(),
        description: 'Private project for space members tests',
        private: true,
        members: [guestName]
      })
      await navigation.checkProjectExist(title)

      const project = await withRequest(playwright, async (request) => {
        const ownerRest = await connectOwnerRest(request)
        const created = await ownerRest.findOne(PROJECT, { name: title })
        if (created === undefined) throw new Error(`Project "${title}" was not created`)
        expect(created.members).toContain(guestAccount)
        expect(await (await connectRest(request, guest)).findAll(PROJECT, { _id: created._id })).toHaveLength(1)
        return created
      })

      await navigation.makeActionWithProject(title, 'Edit project')
      const editProjectPage = new EditProjectPage(owner.page)
      await expect(editProjectPage.popupHeader()).toBeVisible()
      await owner.page
        .locator('form[id="tracker:string:EditProject"] .formRow', {
          has: owner.page.locator('.formRow__label', { hasText: /^Members$/ })
        })
        .locator('.formRow__value button')
        .first()
        .click()
      await editProjectPage.selectPopupInput().fill(guest.lastName)
      const guestItem = editProjectPage.selectPopupListItem(guestName)
      await guestItem.click()
      await expect(guestItem.locator('.check svg')).toBeHidden()
      await owner.page.keyboard.press('Escape')
      // AccountArrayEditor applies member changes with a 500ms debounce; saving earlier drops them.
      await owner.page.waitForTimeout(600)
      await editProjectPage.buttonSaveProject().click()

      await withRequest(playwright, async (request) => {
        const ownerRest = await connectOwnerRest(request)
        await expect.poll(async () => await storedMembers(ownerRest, PROJECT, project._id)).not.toContain(guestAccount)
        const guestRest = await connectRest(request, guest)
        await expect
          .poll(async () => (await guestRest.findAll(PROJECT, { _id: project._id })).length, {
            timeout: REVOKE_TIMEOUT
          })
          .toBe(0)
      })
    } finally {
      await owner.context.close()
    }
  })
})
