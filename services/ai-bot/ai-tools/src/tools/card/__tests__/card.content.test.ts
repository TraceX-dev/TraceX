//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext } from '@hcengineering/ai-core'
import card, { type Card } from '@hcengineering/card'
import core from '@hcengineering/core'

import { cardCreateTool } from '../card.create'
import { cardGetTool } from '../card.get'
import { cardUpdateTool } from '../card.update'
import { attributesForOwner } from '../utils'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  translate: jest.fn(async (label) => label)
}))

jest.mock('@hcengineering/text', () => ({
  htmlToMarkup: jest.fn((html) => html),
  isEmptyMarkup: jest.fn((markup) => markup === undefined || markup === ''),
  jsonToHTML: jest.fn((json) => json.html),
  markupToJSON: jest.fn((markup) => ({ html: markup }))
}))

const masterTagId = 'master-tag' as any
const tagId = 'tag-id' as any
const spaceId = 'space-id' as any

describe('card collaborative content tools', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns card content as top-level HTML and filters collaborative attributes', async () => {
    const doc = createCard({ content: 'content-ref' as any })
    const context = createContext({ doc })

    context.collaborator.getMarkup.mockResolvedValue('<p>Card content</p>')

    const result = await cardGetTool.execute({ cardId: doc._id }, context as any)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.output.content).toBe('<p>Card content</p>')
      expect(result.output.attributes).toEqual([{ key: 'plain', label: 'Plain', value: 'plain-value' }])
      expect((result.output.tags[0] as any).attributes).toEqual([
        { key: 'tagPlain', label: 'Tag plain', value: 'tag-value' }
      ])
    }
    expect(context.collaborator.getMarkup).toHaveBeenCalledWith(
      { objectClass: masterTagId, objectId: doc._id, objectAttr: 'content' },
      'content-ref'
    )
  })

  it('creates collaborator content and stores returned ref on card create', async () => {
    const context = createContext()
    context.collaborator.createMarkup.mockResolvedValue('created-content-ref')

    const result = await cardCreateTool.execute(
      {
        spaceId,
        masterTagId,
        title: 'New card',
        content: '<p>Hello</p>'
      },
      context as any
    )

    expect(result.ok).toBe(true)
    const createdId = result.ok ? result.output.id : undefined
    expect(context.collaborator.createMarkup).toHaveBeenCalledWith(
      { objectClass: masterTagId, objectId: createdId, objectAttr: 'content' },
      '<p>Hello</p>'
    )
    expect(context.client.createDoc).toHaveBeenCalledWith(
      masterTagId,
      spaceId,
      expect.objectContaining({ title: 'New card', content: 'created-content-ref' }),
      createdId
    )
  })

  it('keeps an empty content ref when creating without content', async () => {
    const context = createContext()

    const result = await cardCreateTool.execute(
      {
        spaceId,
        masterTagId,
        title: 'Empty card'
      },
      context as any
    )

    expect(result.ok).toBe(true)
    const createdId = result.ok ? result.output.id : undefined
    expect(context.collaborator.createMarkup).not.toHaveBeenCalled()
    expect(context.client.createDoc).toHaveBeenCalledWith(
      masterTagId,
      spaceId,
      expect.objectContaining({ title: 'Empty card', content: '' }),
      createdId
    )
  })

  it('updates existing collaborator content', async () => {
    const doc = createCard({ content: 'content-ref' as any })
    const context = createContext({ doc })

    const result = await cardUpdateTool.execute(
      {
        cardId: doc._id,
        content: '<p>Updated</p>'
      },
      context as any
    )

    expect(result.ok).toBe(true)
    expect(context.collaborator.updateMarkup).toHaveBeenCalledWith(
      { objectClass: masterTagId, objectId: doc._id, objectAttr: 'content' },
      '<p>Updated</p>'
    )
    expect(context.client.diffUpdate).toHaveBeenCalledWith(doc, {})
  })

  it('creates and saves content ref when updating a card with empty content ref', async () => {
    const doc = createCard({ content: '' as any })
    const context = createContext({ doc })
    context.collaborator.createMarkup.mockResolvedValue('new-content-ref')

    const result = await cardUpdateTool.execute(
      {
        cardId: doc._id,
        content: '<p>Created later</p>'
      },
      context as any
    )

    expect(result.ok).toBe(true)
    expect(context.collaborator.createMarkup).toHaveBeenCalledWith(
      { objectClass: masterTagId, objectId: doc._id, objectAttr: 'content' },
      '<p>Created later</p>'
    )
    expect(context.client.diffUpdate).toHaveBeenCalledWith(doc, { content: 'new-content-ref' })
  })

  it('rejects collaborative attribute keys in create and update attributes', async () => {
    const doc = createCard()
    const context = createContext({ doc })

    const createResult = await cardCreateTool.execute(
      {
        spaceId,
        masterTagId,
        title: 'Invalid card',
        attributes: [{ key: 'collab', value: '<p>Unsupported</p>' }]
      },
      context as any
    )
    const updateResult = await cardUpdateTool.execute(
      {
        cardId: doc._id,
        attributes: [{ key: 'collab', value: '<p>Unsupported</p>' }]
      },
      context as any
    )

    expect(createResult.ok).toBe(false)
    expect(updateResult.ok).toBe(false)
    expect(context.client.createDoc).not.toHaveBeenCalled()
    expect(context.client.diffUpdate).not.toHaveBeenCalled()
  })

  it('filters collaborative attributes from attributesForOwner', () => {
    const context = createContext()

    expect(attributesForOwner(context as any, masterTagId, false, true).map((attr) => attr.name)).toEqual(['plain'])
    expect(attributesForOwner(context as any, tagId, false, true).map((attr) => attr.name)).toEqual(['tagPlain'])
  })
})

function createCard (overrides: Partial<Card> = {}): Card {
  return {
    _id: 'card-id',
    _class: masterTagId,
    space: spaceId,
    title: 'Card title',
    rank: '',
    blobs: {},
    parentInfo: [],
    plain: 'plain-value',
    content: '' as any,
    ...overrides
  } as unknown as Card
}

type TestContext = Omit<PlatformContext, 'client' | 'collaborator'> & {
  client: Record<string, jest.Mock>
  collaborator: {
    createMarkup: jest.Mock
    getMarkup: jest.Mock
    updateMarkup: jest.Mock
  }
}

function createContext ({ doc = createCard() }: { doc?: Card } = {}): TestContext {
  const attributes = new Map<string, any>([
    ['content', createAttribute('content', 'Content', core.class.TypeCollaborativeDoc, masterTagId)],
    ['plain', createAttribute('plain', 'Plain', core.class.TypeString, masterTagId)],
    ['collab', createAttribute('collab', 'Collaborative', core.class.TypeCollaborativeDoc, masterTagId)]
  ])
  const tagAttributes = new Map<string, any>([
    ['tagPlain', createAttribute('tagPlain', 'Tag plain', core.class.TypeString, tagId)],
    ['tagCollab', createAttribute('tagCollab', 'Tag collaborative', core.class.TypeCollaborativeDoc, tagId)]
  ])
  const tag = { _id: tagId, label: 'Tag' }
  const space = { _id: spaceId, name: 'Space', types: [masterTagId] }
  const masterTag = { _id: masterTagId, label: 'Master tag' }

  const hierarchy = {
    as: jest.fn(() => ({ tagPlain: 'tag-value', tagCollab: 'tag-collab-ref' })),
    classHierarchyMixin: jest.fn(() => undefined),
    getAllAttributes: jest.fn(() => attributes),
    getAncestors: jest.fn(() => []),
    getBaseClass: jest.fn(() => masterTagId),
    getClass: jest.fn((id: string) => ({ _id: id, label: id === tagId ? 'Tag' : 'Master tag' })),
    getOwnAttributes: jest.fn(() => tagAttributes),
    hasMixin: jest.fn((_doc, mixin) => mixin === tagId),
    isDerived: jest.fn(() => false),
    isMixin: jest.fn((id) => id === tagId)
  }

  const client = {
    createDoc: jest.fn(),
    createMixin: jest.fn(),
    diffUpdate: jest.fn(),
    findAll: jest.fn(async (clazz) => (clazz === card.class.Tag ? [tag] : [])),
    findOne: jest.fn(async (clazz) => {
      if (clazz === card.class.Card) return doc
      if (clazz === card.class.CardSpace) return space
      if (clazz === card.class.MasterTag) return masterTag
      if (clazz === card.class.Tag) return tag
      return undefined
    }),
    getHierarchy: jest.fn(() => hierarchy),
    getModel: jest.fn(() => ({})),
    updateMixin: jest.fn()
  }

  return {
    client,
    collaborator: {
      createMarkup: jest.fn(),
      getMarkup: jest.fn(),
      updateMarkup: jest.fn()
    },
    ctx: {
      warn: jest.fn()
    },
    hierarchy,
    model: {},
    rawToken: 'raw-token',
    storage: {},
    token: {},
    workspace: 'workspace'
  } as any
}

function createAttribute (name: string, label: string, typeClass: string, attributeOf: string): any {
  return {
    name,
    label,
    attributeOf,
    type: {
      _class: typeClass
    }
  }
}
