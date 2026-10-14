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

import { generateId as newId, type AttachedDoc, type Class, type Doc, type Ref, type Space } from '@hcengineering/core'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { WorkspaceRestClient } from '../API/WorkspaceRestClient'
import { IssuesDetailsPage } from '../model/tracker/issues-details-page'
import { PublicLinkPopup } from '../model/tracker/public-link-popup'
import { type NewIssue } from '../model/tracker/types'
import { prepareNewIssueWithOpenStep } from '../tracker/common-steps'
import { generateId, PlatformURI, PlatformWs, setTestOptions } from '../utils'
import { connectOwnerRest, openAsOwner, withRequest } from './guest-utils'

// Class ids are spelled out: the sanity tests do not depend on the tracker and attachment plugins.
const ISSUE = 'tracker:class:Issue' as Ref<Class<IssueDoc>>
const ATTACHMENT = 'attachment:class:Attachment' as Ref<Class<AttachmentDoc>>
const SPACE = 'core:class:Space' as Ref<Class<Space>>
const PERSON = 'contact:class:Person' as Ref<Class<Doc>>
const SOCIAL_ID = 'contact:class:SocialIdentity' as Ref<Class<Doc>>
const COLLABORATOR = 'core:class:Collaborator' as Ref<Class<Doc>>
const CHANNEL = 'contact:class:Channel' as Ref<Class<Doc>>

interface IssueDoc extends Doc {
  title: string
}

interface AttachmentDoc extends AttachedDoc {
  name: string
  file: string
}

interface LinkedIssue {
  issue: NewIssue
  /** Page of the issue in the workbench. */
  url: string
  link: string
  doc: IssueDoc
}

/**
 * Public links (shared-link guests, role DocGuest). A link opens one document in a read-only page, and the server
 * must not give that session anything else: other documents, their files, or changes. The UI proves nothing about
 * that, so the scenarios talk to the transactor REST API and the front file service with the token of the link.
 *
 * Three issues are used: A and B have a public link, C has none.
 */
test.describe('Public link guest', () => {
  test.describe.configure({ mode: 'serial' })

  let a: LinkedIssue
  let b: LinkedIssue
  let unlinked: IssueDoc
  let workspaceUuid = ''
  let ownerFileId = ''
  let linkedFileId = ''
  let otherFileId = ''

  test.beforeAll(async ({ browser, playwright }) => {
    // Three issues and two links through the UI: more than a single test budget.
    test.setTimeout(300_000)

    const issues: NewIssue[] = ['A', 'B', 'C'].map((name) => ({
      title: `Public link ${name} issue-${generateId()}`,
      description: `Issue ${name} of the public link tests`,
      projectName: 'Default'
    }))

    const links: string[] = []
    const urls: string[] = []
    const { page, context } = await openAsOwner(browser)
    try {
      for (const [index, issue] of issues.entries()) {
        await (await page.goto(`${PlatformURI}/workbench/${PlatformWs}/tracker`))?.finished()
        await setTestOptions(page)
        await prepareNewIssueWithOpenStep(page, issue)
        await new IssuesDetailsPage(page).waitDetailsOpened(issue.title)
        urls.push(page.url())
        if (index < 2) links.push(await openPublicLink(page))
      }
    } finally {
      await context.close()
    }

    await withRequest(playwright, async (request) => {
      const owner = await connectOwnerRest(request)
      workspaceUuid = owner.workspaceUuid
      const docs: IssueDoc[] = []
      for (const issue of issues) {
        const doc = await owner.findOne(ISSUE, { title: issue.title })
        if (doc === undefined) throw new Error(`Issue "${issue.title}" was not created`)
        docs.push(doc)
      }
      a = { issue: issues[0], url: urls[0], link: links[0], doc: docs[0] }
      b = { issue: issues[1], url: urls[1], link: links[1], doc: docs[1] }
      unlinked = docs[2]

      // A file attached to A, a file attached to B and a file that belongs to nobody.
      linkedFileId = await uploadFile(request, owner, 'attached to the issue A')
      otherFileId = await uploadFile(request, owner, 'attached to the issue B')
      ownerFileId = await uploadFile(request, owner, 'attached to nothing')
      await attachFile(owner, a.doc, linkedFileId)
      await attachFile(owner, b.doc, otherFileId)
    })
  })

  async function openPublicLink(page: Page): Promise<string> {
    const details = new IssuesDetailsPage(page)
    await details.moreActionOnIssue('Public link')
    const popup = new PublicLinkPopup(page)
    const link = await popup.getPublicLink()
    await popup.buttonClose().click()
    return link
  }

  async function uploadFile(request: APIRequestContext, owner: WorkspaceRestClient, text: string): Promise<string> {
    const id = newId()
    const response = await request.post(`${PlatformURI}/files/${owner.workspaceUuid}`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      multipart: { file: { name: id, mimeType: 'text/plain', buffer: Buffer.from(text) } }
    })
    expect(response.ok(), `upload of "${text}"`).toBe(true)
    return id
  }

  async function attachFile(owner: WorkspaceRestClient, issue: IssueDoc, file: string): Promise<void> {
    const create = owner.factory.createTxCreateDoc(ATTACHMENT, issue.space, {
      attachedTo: issue._id,
      attachedToClass: ISSUE,
      collection: 'attachments',
      name: `${file}.txt`,
      file,
      size: 10,
      type: 'text/plain',
      lastModified: Date.now()
    } as any)
    const tx = owner.factory.createTxCollectionCUD(ISSUE, issue._id, issue.space, 'attachments', create)
    expect(await owner.tx(tx), 'attach a file').toMatchObject({ ok: true })
  }

  async function getFile(request: APIRequestContext, token: string, id: string): Promise<number> {
    const response = await request.get(`${PlatformURI}/files/${workspaceUuid}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { file: id }
    })
    return response.status()
  }

  test.describe('page', () => {
    test('the link still opens the issue', async ({ browser }) => {
      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        await page.goto(a.link)
        await setTestOptions(page)
        await new IssuesDetailsPage(page).checkIssue({ ...a.issue, status: 'Backlog' })
        expect(page.url()).toContain('guest')
      } finally {
        await context.close()
      }
    })
  })

  test.describe('reading', () => {
    test('reads the linked issue', async ({ playwright }) => {
      await withRequest(playwright, async (request) => {
        const guest = await WorkspaceRestClient.connectDocGuest(request, a.link)
        expect((await guest.findAll(ISSUE, { _id: a.doc._id })).map((it) => it._id)).toEqual([a.doc._id])
      })
    })

    test('does not read other issues, by id or by listing', async ({ playwright }) => {
      await withRequest(playwright, async (request) => {
        const guest = await WorkspaceRestClient.connectDocGuest(request, a.link)
        expect(await guest.findAll(ISSUE, { _id: b.doc._id })).toEqual([])
        expect(await guest.findAll(ISSUE, { _id: unlinked._id })).toEqual([])
        // Listing everything yields the linked issue only.
        expect((await guest.findAll(ISSUE, {})).map((it) => it._id)).toEqual([a.doc._id])
      })
    })

    test('links are isolated from each other', async ({ playwright }) => {
      await withRequest(playwright, async (request) => {
        const guestA = await WorkspaceRestClient.connectDocGuest(request, a.link)
        const guestB = await WorkspaceRestClient.connectDocGuest(request, b.link)
        expect((await guestA.findAll(ISSUE, {})).map((it) => it._id)).toEqual([a.doc._id])
        expect((await guestB.findAll(ISSUE, {})).map((it) => it._id)).toEqual([b.doc._id])
      })
    })

    test('sees only the space of the issue, without its members', async ({ playwright }) => {
      await withRequest(playwright, async (request) => {
        const guest = await WorkspaceRestClient.connectDocGuest(request, a.link)
        // The issue has to be read first: the scope learns its space from it.
        await guest.findAll(ISSUE, { _id: a.doc._id })
        const spaces = await guest.findAll(SPACE, {})
        expect(spaces.map((it) => it._id)).toEqual([a.doc.space])
        expect(spaces[0]).toMatchObject({ members: [], owners: [] })
      })
    })

    test('shows the collaborators of the issue, but not everybody else or their contact details', async ({
      playwright
    }) => {
      await withRequest(playwright, async (request) => {
        const owner = await connectOwnerRest(request)
        const guest = await WorkspaceRestClient.connectDocGuest(request, a.link)
        await guest.findAll(ISSUE, { _id: a.doc._id })

        const collaborators = (await owner.findAll(COLLABORATOR, { attachedTo: a.doc._id })) as unknown as Array<{
          collaborator: string
        }>
        const collaboratorAccounts = new Set(collaborators.map((it) => it.collaborator))
        const guestPersons = (await guest.findAll(PERSON, {})) as unknown as Array<{
          personUuid?: string
          birthday?: unknown
        }>
        const allPersons = await owner.findAll(PERSON, {})
        expect(guestPersons.length).toBeLessThan(allPersons.length)
        for (const person of guestPersons) {
          expect(collaboratorAccounts.has(person.personUuid ?? '')).toBe(true)
          expect(person.birthday).toBeUndefined()
        }

        expect(await guest.findAll(CHANNEL, {})).toEqual([])
        const identities = await guest.findAll(SOCIAL_ID, {})
        for (const identity of identities) expect((identity as { value?: unknown }).value).toBeUndefined()
      })
    })

    test('reads attachments of the linked issue only', async ({ playwright }) => {
      await withRequest(playwright, async (request) => {
        const guest = await WorkspaceRestClient.connectDocGuest(request, a.link)
        await guest.findAll(ISSUE, { _id: a.doc._id })
        const attachments = await guest.findAll(ATTACHMENT, {})
        expect(attachments.map((it) => it.file)).toEqual([linkedFileId])
      })
    })

    test('has no changes allowed', async ({ playwright }) => {
      await withRequest(playwright, async (request) => {
        const guest = await WorkspaceRestClient.connectDocGuest(request, a.link)
        const change = guest.factory.createTxUpdateDoc(ISSUE, a.doc.space, a.doc._id, { title: 'changed by a guest' })
        expect((await guest.tx(change)).ok).toBe(false)

        const owner = await connectOwnerRest(request)
        expect((await owner.findOne(ISSUE, { _id: a.doc._id }))?.title).toBe(a.issue.title)
      })
    })
  })

  test.describe('files', () => {
    test('serves a file of the linked issue', async ({ playwright }) => {
      await withRequest(playwright, async (request) => {
        const guest = await WorkspaceRestClient.connectDocGuest(request, a.link)
        // The page loads the attachments of the issue before it asks for their files.
        await guest.findAll(ISSUE, { _id: a.doc._id })
        await guest.findAll(ATTACHMENT, { attachedTo: a.doc._id })
        expect(await getFile(request, guest.accessToken, linkedFileId)).toBe(200)
      })
    })

    test('does not serve files of other issues or unattached files', async ({ playwright }) => {
      await withRequest(playwright, async (request) => {
        const guest = await WorkspaceRestClient.connectDocGuest(request, a.link)
        await guest.findAll(ISSUE, { _id: a.doc._id })
        await guest.findAll(ATTACHMENT, { attachedTo: a.doc._id })
        expect(await getFile(request, guest.accessToken, otherFileId)).toBe(403)
        expect(await getFile(request, guest.accessToken, ownerFileId)).toBe(403)

        // The owner reads the same files: the rejections come from the link, not from missing files.
        const owner = await connectOwnerRest(request)
        expect(await getFile(request, owner.accessToken, otherFileId)).toBe(200)
        expect(await getFile(request, owner.accessToken, ownerFileId)).toBe(200)
      })
    })

    test('can neither upload nor delete files', async ({ playwright }) => {
      await withRequest(playwright, async (request) => {
        const guest = await WorkspaceRestClient.connectDocGuest(request, a.link)
        const upload = await request.post(`${PlatformURI}/files/${guest.workspaceUuid}`, {
          headers: { Authorization: `Bearer ${guest.accessToken}` },
          multipart: { file: { name: newId(), mimeType: 'text/plain', buffer: Buffer.from('from a guest') } }
        })
        expect(upload.status()).toBe(403)

        const remove = await request.delete(`${PlatformURI}/files/${guest.workspaceUuid}`, {
          headers: { Authorization: `Bearer ${guest.accessToken}` },
          params: { file: linkedFileId }
        })
        expect(remove.status()).toBe(403)

        const owner = await connectOwnerRest(request)
        expect(await getFile(request, owner.accessToken, linkedFileId)).toBe(200)
      })
    })
  })

  test.describe('revoke', () => {
    test('a revoked link reads nothing', async ({ browser, playwright }) => {
      await withRequest(playwright, async (request) => {
        const guest = await WorkspaceRestClient.connectDocGuest(request, b.link)
        expect((await guest.findAll(ISSUE, { _id: b.doc._id })).map((it) => it._id)).toEqual([b.doc._id])

        const { page, context } = await openAsOwner(browser)
        try {
          await (await page.goto(b.url))?.finished()
          await setTestOptions(page)
          const details = new IssuesDetailsPage(page)
          await details.waitDetailsOpened(b.issue.title)
          await details.moreActionOnIssue('Public link')
          await new PublicLinkPopup(page).revokePublicLink()
        } finally {
          await context.close()
        }

        // The session that was opened before the revoke is cut off as well.
        await expect.poll(async () => (await guest.findAll(ISSUE, { _id: b.doc._id })).length).toBe(0)
      })
    })
  })
})
