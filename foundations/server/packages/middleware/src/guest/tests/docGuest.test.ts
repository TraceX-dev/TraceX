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
  DOMAIN_MODEL,
  MeasureMetricsContext,
  docGuestAccountUuid,
  toFindResult,
  TxFactory,
  type Account,
  type Class,
  type Doc,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData
} from '@hcengineering/core'
import contact from '@hcengineering/contact'
import view from '@hcengineering/view'
import type { PipelineContext } from '@hcengineering/server-core'
import { DocGuestMiddleware, publicLinkClass } from '../docGuest'

const DOC = 'test:class:Doc' as Ref<Class<Doc>>
const OTHER = 'test:class:Other' as Ref<Class<Doc>>
const NOTE = 'test:class:Note' as Ref<Class<Doc>> // attached to DOC
const NO_PRESENTER = 'test:class:NoPresenter' as Ref<Class<Doc>>
const CLASS = core.class.Class as Ref<Class<Doc>>
const BLOB = core.class.Blob as Ref<Class<Doc>>
const COLLABORATOR = core.class.Collaborator as Ref<Class<Doc>>
const PERSON = contact.class.Person as Ref<Class<Doc>>
const SOCIAL_ID = contact.class.SocialIdentity as Ref<Class<Doc>>
const CHANNEL = contact.class.Channel as Ref<Class<Doc>>
const ATTACHMENT = 'test:class:Attachment' as Ref<Class<Doc>> // attached to DOC, holds a file

const PARENTS: Record<string, string | undefined> = {
  [core.class.Doc]: undefined,
  [core.class.Space]: core.class.Doc,
  [core.class.AttachedDoc]: core.class.Doc,
  [core.class.Class]: core.class.Doc,
  [contact.class.Contact]: core.class.Doc,
  [contact.class.Person]: contact.class.Contact,
  [SOCIAL_ID]: core.class.AttachedDoc,
  [CHANNEL]: core.class.AttachedDoc,
  [COLLABORATOR]: core.class.AttachedDoc,
  [publicLinkClass]: core.class.Doc,
  [DOC]: core.class.Doc,
  [OTHER]: core.class.Doc,
  [NOTE]: core.class.AttachedDoc,
  [BLOB]: core.class.Doc,
  [ATTACHMENT]: core.class.AttachedDoc,
  [NO_PRESENTER]: core.class.Doc
}
const DOMAINS: Record<string, string> = { [CLASS]: DOMAIN_MODEL }
const PRESENTERS: Record<string, { requiredFields?: string[] }> = {
  [OTHER]: { requiredFields: ['title'] },
  [DOC]: { requiredFields: ['title'] }
}
const ATTRIBUTES: Record<string, Array<[string, any]>> = {
  [ATTACHMENT]: [['file', { type: { _class: core.class.TypeBlob } }]],
  [DOC]: [
    ['related', { type: { _class: core.class.RefTo } }],
    ['hidden', { type: { _class: core.class.RefTo } }],
    ['owner', { type: { _class: core.class.RefTo, to: contact.class.Person } }],
    ['list', { type: { _class: core.class.ArrOf, of: { _class: core.class.RefTo } } }]
  ]
}

const hierarchy = {
  isDerived: (_class: string, base: string): boolean => {
    let current: string | undefined = _class
    while (current !== undefined) {
      if (current === base) return true
      if (!(current in PARENTS)) throw new Error(`Unknown class ${current}`)
      current = PARENTS[current]
    }
    return false
  },
  findDomain: (_class: string) => DOMAINS[_class],
  getAllAttributes: (_class: string) => new Map(ATTRIBUTES[_class] ?? []),
  classHierarchyMixin: (_class: string, mixin: string) =>
    mixin === view.mixin.ObjectPresenter ? PRESENTERS[_class] : undefined
}

const LINK = 'link-a' as Ref<Doc>
const ROOT = 'doc-a' as Ref<Doc>

const STORE: Array<Record<string, any>> = [
  { _id: LINK, _class: publicLinkClass, space: 'space:ws', attachedTo: ROOT },
  { _id: 'link-b', _class: publicLinkClass, space: 'space:ws', attachedTo: 'doc-b' },
  {
    _id: ROOT,
    _class: DOC,
    space: 'space:a',
    createdBy: 'soc-author',
    modifiedBy: 'soc-author',
    owner: 'p-owner',
    title: 'A',
    related: 'other-1',
    hidden: 'secret-1',
    list: ['other-2']
  },
  { _id: 'doc-b', _class: DOC, space: 'space:b', title: 'B' },
  { _id: 'note-1', _class: NOTE, space: 'space:a', attachedTo: ROOT, attachedToClass: DOC },
  { _id: 'note-2', _class: NOTE, space: 'space:a', attachedTo: 'note-1', attachedToClass: NOTE },
  { _id: 'note-b', _class: NOTE, space: 'space:b', attachedTo: 'doc-b', attachedToClass: DOC },
  { _id: 'other-1', _class: OTHER, space: 'space:c', title: 'Related', content: 'private body' },
  { _id: 'other-2', _class: OTHER, space: 'space:c', title: 'Listed', content: 'private body' },
  { _id: 'secret-1', _class: NO_PRESENTER, space: 'space:c', title: 'Secret' },
  { _id: 'att-1', _class: ATTACHMENT, space: 'space:a', attachedTo: ROOT, attachedToClass: DOC, file: 'blob-1' },
  {
    _id: 'blob-1',
    _class: BLOB,
    space: 'space:a',
    contentType: 'image/png',
    size: 5,
    etag: 'secret-etag',
    provider: 's3'
  },
  { _id: 'blob-b', _class: BLOB, space: 'space:b', contentType: 'image/png', size: 7 },
  { _id: 'class-1', _class: CLASS },
  { _id: 'space:a', _class: core.class.Space, members: ['u1'], owners: ['u2'], name: 'A' },
  { _id: 'space:b', _class: core.class.Space, members: ['u3'], owners: [], name: 'B' },
  { _id: 'space:c', _class: core.class.Space, members: [], owners: [], name: 'C' },
  {
    _id: 'collab-1',
    _class: COLLABORATOR,
    space: 'space:a',
    attachedTo: ROOT,
    attachedToClass: DOC,
    collaborator: 'acc-collab'
  },
  {
    _id: 'p-author',
    _class: PERSON,
    space: 'space:contacts',
    name: 'Author',
    personUuid: 'acc-author',
    birthday: 1,
    city: 'Secret'
  },
  { _id: 'p-collab', _class: PERSON, space: 'space:contacts', name: 'Collab', personUuid: 'acc-collab', birthday: 2 },
  { _id: 'p-owner', _class: PERSON, space: 'space:contacts', name: 'Owner', personUuid: 'acc-owner' },
  { _id: 'p-stranger', _class: PERSON, space: 'space:contacts', name: 'Stranger', personUuid: 'acc-stranger' },
  {
    _id: 'soc-author',
    _class: SOCIAL_ID,
    space: 'space:contacts',
    attachedTo: 'p-author',
    attachedToClass: PERSON,
    type: 'email',
    value: 'author@mail.test',
    key: 'email:author@mail.test'
  },
  {
    _id: 'soc-collab',
    _class: SOCIAL_ID,
    space: 'space:contacts',
    attachedTo: 'p-collab',
    attachedToClass: PERSON,
    type: 'email',
    value: 'collab@mail.test',
    key: 'email:collab@mail.test'
  },
  {
    _id: 'soc-stranger',
    _class: SOCIAL_ID,
    space: 'space:contacts',
    attachedTo: 'p-stranger',
    attachedToClass: PERSON,
    type: 'email',
    value: 'stranger@mail.test'
  },
  {
    _id: 'chan-1',
    _class: CHANNEL,
    space: 'space:contacts',
    attachedTo: 'p-author',
    attachedToClass: PERSON,
    value: 'author@mail.test'
  }
]

function matches (doc: Record<string, any>, query: Record<string, any>): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value.$in) && !value.$in.includes(doc[key])) return false
      return true
    }
    return doc[key] === value
  })
}

interface Call {
  _class: string
  query: Record<string, any>
}

function makeAccount (role: AccountRole): Account {
  return {
    uuid: docGuestAccountUuid,
    role,
    primarySocialId: '' as PersonId,
    socialIds: [],
    fullSocialIds: []
  }
}

function makeCtx (account: Account, guestLinkId?: string): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    account,
    guestLinkId,
    broadcast: { txes: [], targets: {}, queue: [], sessions: {} },
    removedMap: new Map(),
    contextCache: new Map(),
    socialStringsToUsers: new Map()
  } as any
  return ctx
}

function makeMiddleware (): { mw: DocGuestMiddleware, calls: Call[] } {
  const calls: Call[] = []
  const next = {
    findAll: async (ctx: MeasureContext<SessionData>, _class: string, query: Record<string, any>, options?: any) => {
      calls.push({ _class, query })
      let docs = STORE.filter((it) => hierarchy.isDerived(it._class, _class) && matches(it, query))
      if (hierarchy.isDerived(_class, PERSON)) {
        // GuestPersonMiddleware: only the accounts published by DocGuestMiddleware are visible.
        const people = ctx.contextData?.contextCache?.get('docGuestPeople')
        docs = docs.filter((it) => people?.accounts.has(it.personUuid) === true)
      }
      let limited: any[] = options?.limit !== undefined ? docs.slice(0, options.limit) : docs
      if (options?.lookup !== undefined && _class === CLASS) {
        // A reverse lookup from a model object reaches every space.
        limited = limited.map((it) => ({
          ...it,
          $lookup: { spaces: STORE.filter((d) => d._class === core.class.Space) }
        }))
      }
      return toFindResult(limited, options?.total === true ? docs.length : -1)
    },
    searchFulltext: async () => ({ docs: [{ id: 'x' }], total: 1 }),
    groupBy: async () => new Map([['x', 1]]),
    tx: async () => ({}),
    handleBroadcast: async () => {}
  }
  const context = { hierarchy } as unknown as PipelineContext
  const mw = new (DocGuestMiddleware as any)(context, next) as DocGuestMiddleware
  return { mw, calls }
}

const docGuest = (linkId: string | undefined = LINK): MeasureContext<SessionData> =>
  makeCtx(makeAccount(AccountRole.DocGuest), linkId)

const ids = (docs: Array<{ _id: string }>): string[] => docs.map((it) => it._id).sort()

describe('DocGuestMiddleware', () => {
  it.each([AccountRole.User, AccountRole.Guest, AccountRole.ReadOnlyGuest])(
    'passes %s through unchanged',
    async (role) => {
      const { mw, calls } = makeMiddleware()
      const res = await mw.findAll(makeCtx(makeAccount(role)), DOC, { title: 'B' })
      expect(ids(res)).toEqual(['doc-b'])
      expect(calls).toEqual([{ _class: DOC, query: { title: 'B' } }])
    }
  )

  it('passes internal calls without contextData through', async () => {
    const { mw } = makeMiddleware()
    const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
    expect(ids(await mw.findAll(ctx, DOC, {}))).toEqual(['doc-a', 'doc-b'])
  })

  it('reads nothing without a link id or for an unknown link', async () => {
    const { mw } = makeMiddleware()
    expect(await mw.findAll(docGuest(''), DOC, {})).toHaveLength(0)
    expect(await mw.findAll(makeCtx(makeAccount(AccountRole.DocGuest)), DOC, {})).toHaveLength(0)
    expect(await mw.findAll(docGuest('missing'), DOC, {})).toHaveLength(0)
  })

  it('returns only the linked document, not other documents', async () => {
    const { mw } = makeMiddleware()
    const ctx = docGuest()
    expect(ids(await mw.findAll(ctx, DOC, {}))).toEqual(['doc-a'])
    expect(await mw.findAll(ctx, DOC, { _id: 'doc-b' as Ref<Doc> })).toHaveLength(0)
    expect(ids(await mw.findAll(docGuest('link-b'), DOC, {}))).toEqual(['doc-b'])
  })

  it('reads its own public link only', async () => {
    const { mw } = makeMiddleware()
    expect(ids(await mw.findAll(docGuest(), publicLinkClass, {}))).toEqual([LINK])
  })

  it('limits attached objects to the linked document tree', async () => {
    const { mw } = makeMiddleware()
    const ctx = docGuest()
    await mw.findAll(ctx, DOC, {})
    expect(ids(await mw.findAll(ctx, NOTE, {}))).toEqual(['note-1'])
    expect(ids(await mw.findAll(ctx, NOTE, { attachedTo: 'doc-b' }))).toEqual([])
    // Nested attachment is reached through its parent chain, even when asked by id first.
    expect(ids(await mw.findAll(docGuest(), NOTE, { _id: 'note-2' as Ref<Doc> }))).toEqual(['note-2'])
    expect(await mw.findAll(docGuest(), NOTE, { _id: 'note-b' as Ref<Doc> })).toHaveLength(0)
  })

  it('exposes referenced objects through presenter fields only', async () => {
    const { mw } = makeMiddleware()
    const ctx = docGuest()
    expect(await mw.findAll(ctx, OTHER, { _id: 'other-1' as Ref<Doc> })).toHaveLength(0) // not discovered yet
    await mw.findAll(ctx, DOC, {})
    const related = await mw.findAll(ctx, OTHER, {})
    expect(ids(related)).toEqual(['other-1', 'other-2'])
    expect(related.find((it) => it._id === 'other-1')).toEqual({
      _id: 'other-1',
      _class: OTHER,
      space: 'space:c',
      title: 'Related'
    })
  })

  it('exposes only blobs referenced by attachments of the linked document', async () => {
    const { mw } = makeMiddleware()
    const ctx = docGuest()
    expect(await mw.findAll(ctx, BLOB, {})).toHaveLength(0) // attachment not read yet
    await mw.findAll(ctx, DOC, {})
    await mw.findAll(ctx, ATTACHMENT, {})
    const blobs = await mw.findAll(ctx, BLOB, {})
    expect(ids(blobs)).toEqual(['blob-1'])
    expect(blobs[0]).toEqual({ _id: 'blob-1', _class: BLOB, space: 'space:a', contentType: 'image/png', size: 5 })
    expect(await mw.findAll(ctx, BLOB, { _id: 'blob-b' as Ref<Doc> })).toHaveLength(0)
  })

  describe('people', () => {
    async function read (mw: DocGuestMiddleware): Promise<MeasureContext<SessionData>> {
      const ctx = docGuest()
      await mw.findAll(ctx, DOC, {})
      return ctx
    }

    it('shows nobody to a session without a link', async () => {
      const { mw } = makeMiddleware()
      expect(await mw.findAll(makeCtx(makeAccount(AccountRole.DocGuest), undefined), PERSON, {})).toHaveLength(0)
    })

    it('shows only the collaborators of the linked document, by name and avatar', async () => {
      const { mw } = makeMiddleware()
      const persons = await mw.findAll(await read(mw), PERSON, {})
      expect(ids(persons)).toEqual(['p-collab'])
      const collab = persons[0] as unknown as Record<string, unknown>
      expect(collab).toMatchObject({ name: 'Collab', personUuid: 'acc-collab' })
      expect(collab.birthday).toBeUndefined()
    })

    it('hides authors and referenced persons who are not collaborators', async () => {
      const { mw } = makeMiddleware()
      const ctx = await read(mw)
      const hidden = ['p-author', 'p-owner', 'p-stranger']
      expect(await mw.findAll(ctx, PERSON, { _id: { $in: hidden } as any })).toHaveLength(0)
      expect(ids(await mw.findAll(ctx, contact.class.Contact, {}))).toEqual(['p-collab'])
    })

    it('resolves social ids of the collaborators without the identity values', async () => {
      const { mw } = makeMiddleware()
      const identities = await mw.findAll(await read(mw), SOCIAL_ID, {
        _id: { $in: ['soc-author', 'soc-collab', 'soc-stranger'] } as any
      })
      expect(ids(identities)).toEqual(['soc-collab'])
      expect(identities[0]).toMatchObject({ _id: 'soc-collab', attachedTo: 'p-collab', type: 'email' })
      expect((identities[0] as any).value).toBeUndefined()
      expect((identities[0] as any).key).toBeUndefined()
    })

    it('hides contact channels', async () => {
      const { mw } = makeMiddleware()
      expect(await mw.findAll(await read(mw), CHANNEL, {})).toHaveLength(0)
    })

    it('publishes the collaborators for GuestPersonMiddleware', async () => {
      const { mw } = makeMiddleware()
      const ctx = await read(mw)
      const people = ctx.contextData.contextCache?.get('docGuestPeople')
      expect([...people.accounts]).toEqual(['acc-collab'])
      expect([...people.personRefs]).toEqual(['p-collab'])
    })

    it('reads collaborator records of the linked document', async () => {
      const { mw } = makeMiddleware()
      const collaborators = await mw.findAll(await read(mw), COLLABORATOR, {})
      expect(ids(collaborators)).toEqual(['collab-1'])
    })
  })

  it('hides referenced objects whose class has no requiredFields', async () => {
    const { mw } = makeMiddleware()
    const ctx = docGuest()
    await mw.findAll(ctx, DOC, {})
    expect(await mw.findAll(ctx, NO_PRESENTER, {})).toHaveLength(0)
  })

  it('shows only spaces of the linked document, without members', async () => {
    const { mw } = makeMiddleware()
    const ctx = docGuest()
    expect(await mw.findAll(ctx, core.class.Space, {})).toHaveLength(0)
    await mw.findAll(ctx, DOC, {})
    const spaces = await mw.findAll(ctx, core.class.Space, {})
    expect(ids(spaces)).toEqual(['space:a'])
    expect(spaces[0]).toMatchObject({ members: [], owners: [] })
  })

  it('does not trust a projection that omits the fields used for the check', async () => {
    const { mw, calls } = makeMiddleware()
    await mw.findAll(docGuest(), DOC, {}, { projection: { title: 1 } } as any)
    const call = calls.find((it) => it._class === DOC)
    expect(call?.query._id.$in).toBeDefined()
  })

  it('filters $lookup and $associations results', async () => {
    const { mw } = makeMiddleware()
    const ctx = docGuest()
    const next = (mw as any).next
    const original = next.findAll
    next.findAll = async (...args: any[]) => {
      const res = await original(...args)
      if (args[1] === DOC) {
        const root = { ...res[0], $lookup: { related: STORE[7], hidden: STORE[9], list: [STORE[8], STORE[3]] } }
        root.$associations = { rel: [STORE[7], STORE[3]] } as any
        return toFindResult([root] as any[], 1)
      }
      return res
    }
    const [doc] = await mw.findAll(ctx, DOC, {}, { lookup: { related: OTHER }, associations: [] } as any)
    const lookup = (doc as any).$lookup
    expect(lookup.related).toMatchObject({ _id: 'other-1', title: 'Related' })
    expect(lookup.related.content).toBeUndefined()
    expect(lookup.hidden).toBeUndefined()
    expect(ids(lookup.list)).toEqual(['other-2'])
    expect(ids((doc as any).$associations.rel)).toEqual(['other-1'])
  })

  it('passes model classes through', async () => {
    const { mw, calls } = makeMiddleware()
    await mw.findAll(docGuest(), CLASS, {})
    expect(calls.filter((it) => it._class === CLASS)).toEqual([{ _class: CLASS, query: {} }])
  })

  it('filters lookups of model objects', async () => {
    const { mw } = makeMiddleware()
    const ctx = docGuest()
    await mw.findAll(ctx, DOC, {})
    const [klass] = await mw.findAll(ctx, CLASS, {}, { lookup: { _id: { spaces: [core.class.Space, 'type'] } } } as any)
    const spaces = (klass as any).$lookup.spaces
    expect(ids(spaces)).toEqual(['space:a'])
    expect(spaces[0].members).toEqual([])
  })

  it('drops lookups of model objects when the link is gone', async () => {
    const { mw } = makeMiddleware()
    const [klass] = await mw.findAll(docGuest('missing' as any), CLASS, {}, { lookup: { _id: { x: 'y' } } } as any)
    expect(klass.$lookup).toBeUndefined()
  })

  it('closes fulltext search and groupBy, but not for other roles', async () => {
    const { mw } = makeMiddleware()
    expect((await mw.searchFulltext(docGuest(), { query: 'x' }, {})).docs).toEqual([])
    expect((await mw.groupBy(docGuest(), 'domain' as any, 'field')).size).toBe(0)
    const user = makeCtx(makeAccount(AccountRole.User))
    expect((await mw.searchFulltext(user, { query: 'x' }, {})).docs).toHaveLength(1)
    expect((await mw.groupBy(user, 'domain' as any, 'field')).size).toBe(1)
  })

  it('forgets a revoked link', async () => {
    const { mw } = makeMiddleware()
    const ctx = docGuest()
    expect(await mw.findAll(ctx, DOC, {})).toHaveLength(1)
    const factory = new TxFactory('u' as any)
    STORE.splice(0, 1)
    try {
      await mw.tx(ctx, [factory.createTxRemoveDoc(publicLinkClass, 'space:ws' as any, LINK)])
      expect(await mw.findAll(ctx, DOC, {})).toHaveLength(0)
    } finally {
      STORE.unshift({ _id: LINK, _class: publicLinkClass, space: 'space:ws', attachedTo: ROOT })
    }
  })

  describe('broadcast', () => {
    async function target (mw: DocGuestMiddleware, tx: any): Promise<unknown> {
      const ctx = docGuest()
      await mw.handleBroadcast(ctx)
      return await ctx.contextData.broadcast.targets.docGuest(tx)
    }

    it('excludes DocGuests from unrelated transactions and keeps related ones', async () => {
      const { mw } = makeMiddleware()
      const factory = new TxFactory('u' as any)
      await mw.findAll(docGuest(), DOC, {})
      const own = factory.createTxUpdateDoc(DOC, 'space:a' as any, ROOT, { title: 'x' } as any)
      const foreign = factory.createTxUpdateDoc(DOC, 'space:b' as any, 'doc-b' as any, { title: 'x' } as any)
      expect(await target(mw, own)).toBeUndefined()
      expect(await target(mw, foreign)).toEqual({ exclude: [docGuestAccountUuid] })
    })

    it('does not deliver transactions of referenced objects', async () => {
      const { mw } = makeMiddleware()
      const factory = new TxFactory('u' as any)
      await mw.findAll(docGuest(), DOC, {})
      const tx = factory.createTxUpdateDoc(OTHER, 'space:a' as any, 'other-1' as any, { title: 'x' } as any)
      expect(await target(mw, tx)).toEqual({ exclude: [docGuestAccountUuid] })
    })

    it('stops delivering an attachment moved out of the document', async () => {
      const { mw } = makeMiddleware()
      const factory = new TxFactory('u' as any)
      const ctx = docGuest()
      await mw.findAll(ctx, DOC, {})
      await mw.findAll(ctx, NOTE, {})
      const move = factory.createTxUpdateDoc(NOTE, 'space:a' as any, 'note-1' as any, { attachedTo: 'doc-b' } as any)
      const note = STORE.find((it) => it._id === 'note-1') as Record<string, any>
      note.attachedTo = 'doc-b'
      try {
        await mw.tx(ctx, [move])
        expect(await mw.findAll(docGuest(), NOTE, { _id: 'note-1' as Ref<Doc> })).toHaveLength(0)
      } finally {
        note.attachedTo = ROOT
      }
    })

    it('delivers attachments created under the linked document', async () => {
      const { mw } = makeMiddleware()
      const factory = new TxFactory('u' as any)
      await mw.findAll(docGuest(), DOC, {})
      const tx = factory.createTxCreateDoc(NOTE, 'space:a' as any, {}, 'note-new' as any)
      ;(tx as any).attachedTo = ROOT
      await mw.tx(docGuest(), [tx])
      expect(await target(mw, tx)).toBeUndefined()
    })
  })
})
