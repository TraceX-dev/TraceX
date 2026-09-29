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

import {
  AccountRole,
  type AttachedDoc,
  type Class,
  type Data,
  type Doc,
  type Ref,
  type TxCUD
} from '@hcengineering/core'
import { expect, test } from '@playwright/test'
import { type WorkspaceRestClient } from '../API/WorkspaceRestClient'
import { IssuesPage } from '../model/tracker/issues-page'
import { NewProjectPage } from '../model/tracker/new-project-page'
import { TrackerNavigationMenuPage } from '../model/tracker/tracker-navigation-menu-page'
import { prepareNewIssueWithOpenStep } from '../tracker/common-steps'
import { generateProjectId } from '../tracker/tracker.utils'
import { generateId, generateUser, PlatformURI, PlatformWs, setTestOptions } from '../utils'
import {
  connectOwnerRest,
  connectRest,
  createWorkspaceMember,
  FORBIDDEN,
  loginAs,
  markup,
  newIssueButton,
  openAsOwner,
  withRequest
} from './guest-utils'

// Class ids are spelled out: the sanity tests do not depend on the tracker and chunter plugins.
const ISSUE = 'tracker:class:Issue' as Ref<Class<IssueDoc>>
const COMPONENT = 'tracker:class:Component' as Ref<Class<Doc>>
const CHAT_MESSAGE = 'chunter:class:ChatMessage' as Ref<Class<CommentDoc>>

interface IssueDoc extends Doc {
  title: string
}

interface CommentDoc extends AttachedDoc {
  message: string
}

interface CreatedComment {
  id: Ref<CommentDoc>
  message: string
}

/**
 * Checks what a Guest can do through the UI and, for rejections, through the transactor REST API:
 * a hidden button proves nothing about the server, so every "can not" is checked by sending the tx.
 */
test.describe('Guest access', () => {
  test.describe.configure({ mode: 'serial' })

  const guest = generateUser()
  const guestName = `${guest.lastName} ${guest.firstName}`

  const sharedProject = `Guest-shared-${generateProjectId()}`
  const hiddenProject = `Guest-hidden-${generateProjectId()}`
  const sharedIssueTitle = `Guest shared issue-${generateId()}`
  const hiddenIssueTitle = `Guest hidden issue-${generateId()}`

  let sharedIssue: IssueDoc
  let ownerComment: CreatedComment

  test.beforeAll(async ({ browser, playwright }) => {
    // A member, two projects and two issues through the UI: more than a single test budget.
    test.setTimeout(300_000)

    await createWorkspaceMember(playwright, browser, guest, AccountRole.Guest)

    const { page, context } = await openAsOwner(browser)
    try {
      const navigation = new TrackerNavigationMenuPage(page)
      for (const [title, members] of [
        [sharedProject, [guestName]],
        [hiddenProject, []]
      ] as const) {
        await navigation.pressCreateProjectButton()
        await new NewProjectPage(page).createNewProject({
          title,
          identifier: title.slice(-5),
          description: 'Private project for guest access tests',
          private: true,
          members: [...members]
        })
        await navigation.checkProjectExist(title)
      }

      await prepareNewIssueWithOpenStep(page, {
        title: sharedIssueTitle,
        description: 'Issue in a project shared with the guest',
        projectName: sharedProject
      })
      // Leave the opened issue, so the second issue starts from the plain issue list.
      await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}/tracker`))?.finished()
      await prepareNewIssueWithOpenStep(page, {
        title: hiddenIssueTitle,
        description: 'Issue in a project the guest is not a member of',
        projectName: hiddenProject
      })
    } finally {
      await context.close()
    }

    await withRequest(playwright, async (request) => {
      const owner = await connectOwnerRest(request)
      const issue = await owner.findOne(ISSUE, { title: sharedIssueTitle })
      if (issue === undefined) throw new Error(`Issue "${sharedIssueTitle}" was not created`)
      sharedIssue = issue
      ownerComment = await addComment(owner, 'Comment of the owner')
    })
  })

  async function addComment (client: WorkspaceRestClient, text: string): Promise<CreatedComment> {
    const message = markup(`${text} ${generateId(8)}`)
    const tx = commentTx(
      client,
      client.factory.createTxCreateDoc(CHAT_MESSAGE, sharedIssue.space, { message } as unknown as Data<CommentDoc>)
    )
    const result = await client.tx(tx)
    expect(result, `create a comment as ${client.account.primarySocialId}`).toMatchObject({ ok: true })
    return { id: tx.objectId, message }
  }

  /** Puts a comment tx into the `comments` collection of the shared issue, as TxOperations does. */
  function commentTx (client: WorkspaceRestClient, tx: TxCUD<CommentDoc>): TxCUD<CommentDoc> {
    return client.factory.createTxCollectionCUD(ISSUE, sharedIssue._id, sharedIssue.space, 'comments', tx)
  }

  function updateComment (client: WorkspaceRestClient, id: Ref<CommentDoc>, text: string): TxCUD<CommentDoc> {
    return commentTx(
      client,
      client.factory.createTxUpdateDoc(CHAT_MESSAGE, sharedIssue.space, id, { message: markup(text) })
    )
  }

  function removeComment (client: WorkspaceRestClient, id: Ref<CommentDoc>): TxCUD<CommentDoc> {
    return commentTx(client, client.factory.createTxRemoveDoc(CHAT_MESSAGE, sharedIssue.space, id))
  }

  test('Guest sees only the private projects it is a member of', async ({ browser, playwright }) => {
    const { page, context } = await loginAs(browser, guest)
    try {
      await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}/tracker`))?.finished()
      await setTestOptions(page)
      const navigation = new TrackerNavigationMenuPage(page)
      // The positive check waits for the project list, so the negative one runs on a loaded list.
      await navigation.checkProjectExist(sharedProject)
      await navigation.checkProjectNotExist(hiddenProject)
    } finally {
      await context.close()
    }

    await withRequest(playwright, async (request) => {
      const guestRest = await connectRest(request, guest)
      expect(await guestRest.findAll(ISSUE, { title: sharedIssueTitle })).toHaveLength(1)
      expect(await guestRest.findAll(ISSUE, { title: hiddenIssueTitle })).toHaveLength(0)
      // Control: the same query finds the hidden issue for the owner.
      const owner = await connectOwnerRest(request)
      expect(await owner.findAll(ISSUE, { title: hiddenIssueTitle })).toHaveLength(1)
    })
  })

  test('Guest can create an issue in a shared project', async ({ browser, playwright }) => {
    const title = `Guest created issue-${generateId()}`
    const { page, context } = await loginAs(browser, guest)
    try {
      await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}/tracker`))?.finished()
      await setTestOptions(page)
      await newIssueButton(page).click()
      const issuesPage = new IssuesPage(page)
      await issuesPage.fillNewIssueForm({
        title,
        description: 'Issue created by a guest',
        projectName: sharedProject
      })
      await issuesPage.clickButtonCreateIssue()
    } finally {
      await context.close()
    }

    await withRequest(playwright, async (request) => {
      const owner = await connectOwnerRest(request)
      await expect
        .poll(async () => (await owner.findAll(ISSUE, { title })).map((it) => it.space))
        .toEqual([sharedIssue.space])
    })
  })

  test('Server rejects a class guests are not allowed to create', async ({ playwright }) => {
    await withRequest(playwright, async (request) => {
      const guestRest = await connectRest(request, guest)
      // Control: a comment (createAccessLevel Guest) goes through the same channel.
      await addComment(guestRest, 'Allowed comment of the guest')

      const component = guestRest.factory.createTxCreateDoc(COMPONENT, sharedIssue.space, {
        label: `Guest component ${generateId(8)}`,
        description: ''
      })
      const result = await guestRest.tx(component)
      expect(result.ok).toBe(false)
      expect(result.error).toContain(FORBIDDEN)

      const owner = await connectOwnerRest(request)
      expect(await owner.findAll(COMPONENT, { _id: component.objectId })).toHaveLength(0)
    })
  })

  test('Guest can edit and delete only its own comments', async ({ playwright }) => {
    await withRequest(playwright, async (request) => {
      const guestRest = await connectRest(request, guest)
      const owner = await connectOwnerRest(request)

      const updateOthers = await guestRest.tx(updateComment(guestRest, ownerComment.id, 'Edited by the guest'))
      expect(updateOthers.ok, 'update a comment of the owner').toBe(false)
      expect(updateOthers.error).toContain(FORBIDDEN)

      const removeOthers = await guestRest.tx(removeComment(guestRest, ownerComment.id))
      expect(removeOthers.ok, 'remove a comment of the owner').toBe(false)
      expect(removeOthers.error).toContain(FORBIDDEN)

      expect((await owner.findOne(CHAT_MESSAGE, { _id: ownerComment.id }))?.message).toBe(ownerComment.message)

      const own = await addComment(guestRest, 'Own comment of the guest')
      const edited = `Edited own comment ${generateId(8)}`
      expect(await guestRest.tx(updateComment(guestRest, own.id, edited)), 'update own comment').toMatchObject({
        ok: true
      })
      expect((await owner.findOne(CHAT_MESSAGE, { _id: own.id }))?.message).toBe(markup(edited))

      expect(await guestRest.tx(removeComment(guestRest, own.id)), 'remove own comment').toMatchObject({ ok: true })
      expect(await owner.findAll(CHAT_MESSAGE, { _id: own.id })).toHaveLength(0)
    })
  })
})
