//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext, createTool, toolOk } from '@hcengineering/ai-core'
import card, { type Card, type CardSpace, type MasterTag, type Tag } from '@hcengineering/card'
import core, { type Class, type Doc, type DocumentQuery, type Ref, SortingOrder, Space } from '@hcengineering/core'
import { Type, type Static } from 'typebox'
import { SpaceSummarySchema, ClassSummarySchema, buildClassSummary, buildSpaceSummary } from '../shared'
import { cardGetToolId, cardSearchToolId } from './tool-ids'

export const SearchCardsInputSchema = Type.Object(
  {
    spaceId: Type.Optional(
      Type.String({
        description: 'Optional card space identifier to restrict search results.'
      })
    ),
    masterTagId: Type.Optional(
      Type.String({
        description: 'Optional master tag identifier to restrict search results to one card type.'
      })
    ),
    query: Type.Optional(
      Type.String({
        description: 'Optional case-insensitive title text filter.'
      })
    ),
    version: Type.Optional(
      Type.Enum(['latest', 'all'], {
        description: 'Version filter. Defaults to latest; use all to include historical versions.'
      })
    ),
    limit: Type.Optional(
      Type.Number({
        default: 50,
        maximum: 200,
        description: 'Maximum number of cards to return. Defaults to 50.'
      })
    )
  },
  {
    description: 'Parameters for searching cards.'
  }
)

export const SearchCardsOutputSchema = Type.Object(
  {
    cards: Type.Array(
      Type.Object(
        {
          id: Type.String({
            description: 'Stable card identifier.'
          }),
          title: Type.String({
            description: 'Card title.'
          }),
          masterTag: Type.With(ClassSummarySchema, {
            description: 'Card master tag summary.'
          }),
          space: Type.With(SpaceSummarySchema, {
            description: 'Card space summary.'
          }),
          tags: Type.Array(
            Type.With(ClassSummarySchema, {
              description: 'Card tag summary.'
            }),
            {
              description: 'Active tags on the card.'
            }
          )
        },
        {
          description: 'Compact card search result.'
        }
      ),
      {
        description: `Cards matching the search criteria. Use ${cardGetToolId} to load attributes and active tags.`
      }
    )
  },
  {
    description: 'Card search results.'
  }
)

type SearchCardsInput = Static<typeof SearchCardsInputSchema>
type SearchCardsOutput = Static<typeof SearchCardsOutputSchema>

export const cardSearchTool = createTool({
  name: cardSearchToolId,
  description: `Search cards and return compact card references. Use ${cardGetToolId} to load attributes and active tags.`,
  inputSchema: SearchCardsInputSchema,
  outputSchema: SearchCardsOutputSchema,
  execute: async (args: SearchCardsInput, toolCtx: PlatformContext) => {
    const { client } = toolCtx

    const query: DocumentQuery<Card> = {}
    const spaceId = args.spaceId as Ref<CardSpace> | undefined
    const masterTagId = args.masterTagId as Ref<MasterTag> | undefined
    const text = typeof args.query === 'string' ? args.query.trim() : ''
    const limit = typeof args.limit === 'number' ? args.limit : 50

    if (spaceId !== undefined) {
      ;(query as any).space = spaceId
    }
    if (masterTagId !== undefined) {
      ;(query as any)._class = masterTagId
    }
    if (args.version !== 'all') {
      ;(query as any).isLatest = { $in: [true, undefined] }
    }

    if (text.length > 0) {
      const ids = await searchCardIds(toolCtx, text, limit, spaceId, masterTagId)
      if (ids.length === 0) {
        return toolOk({ cards: [] })
      }

      ;(query as any)._id = { $in: ids }
      const docs = await client.findAll(card.class.Card, query, { limit: ids.length })
      const docsById = new Map(docs.map((doc) => [doc._id, doc]))
      const orderedDocs = ids.flatMap((id) => {
        const doc = docsById.get(id)
        return doc !== undefined ? [doc] : []
      })

      return toolOk(await buildSearchOutput(toolCtx, orderedDocs))
    }

    const docs = await client.findAll(card.class.Card, query, {
      limit,
      sort: { modifiedOn: SortingOrder.Descending }
    })

    return toolOk(await buildSearchOutput(toolCtx, docs))
  }
})

async function buildSearchOutput (toolCtx: PlatformContext, docs: Card[]): Promise<SearchCardsOutput> {
  const spaces = await loadSpaces(toolCtx, docs)
  const tags = await toolCtx.client.findAll(card.class.Tag, {})
  const cards = await Promise.all(
    docs.map(async (doc) => ({
      id: doc._id,
      title: doc.title,
      masterTag: await buildClassSummary(toolCtx.hierarchy, doc._class),
      space: buildSpaceSummary(doc.space, spaces.get(doc.space)),
      tags: await summarizeActiveTags(toolCtx, doc, tags)
    }))
  )

  return { cards }
}

async function summarizeActiveTags (
  toolCtx: PlatformContext,
  doc: Card,
  tags: Tag[]
): Promise<Array<{ id: string, name: string }>> {
  return await Promise.all(
    tags.flatMap((tag) =>
      toolCtx.hierarchy.hasMixin(doc, tag._id) ? [buildClassSummary(toolCtx.hierarchy, tag._id)] : []
    )
  )
}

async function loadSpaces (toolCtx: PlatformContext, docs: Card[]): Promise<Map<Ref<Space>, Space>> {
  const spaceIds = [...new Set(docs.map((doc) => doc.space))]
  if (spaceIds.length === 0) {
    return new Map()
  }

  const spaces = await toolCtx.client.findAll(core.class.Space, { _id: { $in: spaceIds } })
  return new Map(spaces.map((space) => [space._id, space]))
}

async function searchCardIds (
  toolCtx: PlatformContext,
  query: string,
  limit: number,
  spaceId: Ref<CardSpace> | undefined,
  masterTagId: Ref<MasterTag> | undefined
): Promise<Array<Ref<Card>>> {
  const classes =
    masterTagId !== undefined
      ? [masterTagId as Ref<Class<Doc>>]
      : ([card.class.Card, ...toolCtx.hierarchy.getDescendants(card.class.Card)] as Array<Ref<Class<Doc>>>)

  const result = await toolCtx.client.searchFulltext(
    {
      query: `${query}*`,
      classes,
      ...(spaceId !== undefined ? { spaces: [spaceId] } : {})
    },
    {
      limit
    }
  )

  return result.docs.map((doc) => doc.id as Ref<Card>)
}
