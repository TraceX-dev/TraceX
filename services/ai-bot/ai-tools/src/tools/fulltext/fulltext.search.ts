//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext, createTool, toolOk } from '@hcengineering/ai-core'
import core, { type Class, type Doc, type DocumentQuery, type Ref, type Space } from '@hcengineering/core'
import { Type, type Static } from 'typebox'
import { buildClassSummary, ClassSummarySchema, SpaceSummarySchema } from '../shared'
import { fulltextSearchToolId } from './tool-ids'

export const FulltextSearchInputSchema = Type.Object(
  {
    query: Type.String({
      description: 'Fulltext query string. The search tool applies prefix matching automatically.'
    }),
    classes: Type.Optional(
      Type.Array(Type.String({ description: 'Class identifier to search in, for example card:class:Card.' }), {
        description: 'Optional class identifiers to restrict search results.'
      })
    ),
    spaces: Type.Optional(
      Type.Array(Type.String({ description: 'Space identifier to search in.' }), {
        description: 'Optional space identifiers to restrict search results.'
      })
    ),
    includeDescendants: Type.Optional(
      Type.Boolean({
        default: true,
        description: 'Include descendants of requested classes. Defaults to true.'
      })
    ),
    limit: Type.Optional(
      Type.Number({
        default: 50,
        maximum: 200,
        description: 'Maximum number of search results. Defaults to 50.'
      })
    )
  },
  {
    description: 'Parameters for generic fulltext search.'
  }
)

export const FulltextSearchOutputSchema = Type.Object(
  {
    results: Type.Array(
      Type.Object(
        {
          id: Type.String({
            description: 'Stable object identifier.'
          }),
          title: Type.String({
            description: 'Search result title.'
          }),
          class: ClassSummarySchema,
          space: Type.Optional(SpaceSummarySchema),
          score: Type.Optional(
            Type.Number({
              description: 'Fulltext relevance score, when provided by the search backend.'
            })
          )
        },
        {
          description: 'Compact fulltext search result.'
        }
      ),
      {
        description: 'Fulltext search results.'
      }
    )
  },
  {
    description: 'Generic fulltext search results.'
  }
)

type FulltextSearchInput = Static<typeof FulltextSearchInputSchema>
type FulltextSearchOutput = Static<typeof FulltextSearchOutputSchema>

export const fulltextSearchTool = createTool({
  name: fulltextSearchToolId,
  description: 'Search indexed workspace objects by fulltext and return compact object references.',
  inputSchema: FulltextSearchInputSchema,
  outputSchema: FulltextSearchOutputSchema,
  execute: async (args: FulltextSearchInput, toolCtx: PlatformContext) => {
    const query = args.query.trim()
    if (query.length === 0) {
      return toolOk({ results: [] })
    }

    const classesFilter =
      args.classes !== undefined ? { classes: expandClasses(toolCtx, args.classes, args.includeDescendants) } : {}

    const spacesFilter = args.spaces !== undefined ? { spaces: args.spaces as Array<Ref<Space>> } : {}

    const limit = args.limit ?? 50
    const result = await toolCtx.client.searchFulltext(
      {
        query: `${query}*`,
        ...classesFilter,
        ...spacesFilter
      },
      { limit }
    )

    const docsById = await loadResultDocs(toolCtx, result.docs)
    const spacesById = await loadSpaces(toolCtx, [...docsById.values()])

    const output: FulltextSearchOutput = {
      results: await Promise.all(
        result.docs.map(async (searchResult) => {
          const doc = docsById.get(searchResult.id)
          const spaceId = doc?.space
          const space = spaceId !== undefined ? spacesById.get(spaceId) : undefined

          return {
            id: searchResult.id,
            title: searchResult.title ?? searchResult.shortTitle ?? getTitle(doc) ?? searchResult.id,
            class: await buildClassSummary(toolCtx.hierarchy, searchResult.doc._class),
            ...(space !== undefined ? { space: { id: space._id, name: space.name } } : {}),
            ...(searchResult.score !== undefined ? { score: searchResult.score } : {})
          }
        })
      )
    }

    return toolOk(output)
  }
})

function expandClasses (
  toolCtx: PlatformContext,
  classes: string[],
  includeDescendants: boolean | undefined
): Array<Ref<Class<Doc>>> {
  const result = new Set<Ref<Class<Doc>>>()
  for (const classId of classes) {
    const id = classId as Ref<Class<Doc>>
    result.add(id)
    if (includeDescendants !== false) {
      try {
        for (const descendant of toolCtx.hierarchy.getDescendants(id)) {
          result.add(descendant)
        }
      } catch {
        // descendants not found, ignore
      }
    }
  }
  return [...result]
}

async function loadResultDocs (
  toolCtx: PlatformContext,
  results: Array<{ id: Ref<Doc>, doc: Pick<Doc, '_id' | '_class' | 'createdOn'> }>
): Promise<Map<Ref<Doc>, Doc>> {
  // map doc ids by class
  const idsByClass = new Map<Ref<Class<Doc>>, Array<Ref<Doc>>>()
  for (const result of results) {
    const ids = idsByClass.get(result.doc._class) ?? []
    ids.push(result.id)
    idsByClass.set(result.doc._class, ids)
  }

  const docs = new Map<Ref<Doc>, Doc>()
  await Promise.all(
    [...idsByClass.entries()].map(async ([classId, ids]) => {
      const query: DocumentQuery<Doc> = { _id: { $in: ids } }
      const loaded = await toolCtx.client.findAll(classId, query)
      for (const doc of loaded) {
        docs.set(doc._id, doc)
      }
    })
  )
  return docs
}

async function loadSpaces (toolCtx: PlatformContext, docs: Doc[]): Promise<Map<Ref<Space>, Space>> {
  const spaceIds = [...new Set(docs.map((doc) => doc.space))]

  if (spaceIds.length === 0) {
    return new Map()
  }

  const spaces = await toolCtx.client.findAll(core.class.Space, { _id: { $in: spaceIds } })
  return new Map(spaces.map((space) => [space._id, space]))
}

function getTitle (doc: Doc | undefined): string | undefined {
  if (doc === undefined) return undefined
  const title = (doc as any).title ?? (doc as any).name
  return typeof title === 'string' && title.length > 0 ? title : undefined
}
