//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext, createTool, toolOk } from '@hcengineering/ai-core'
import core, {
  SortingOrder,
  type Class,
  type Doc,
  type DocumentQuery,
  type Ref,
  type SortingQuery,
  type Space,
  type WithLookup
} from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import serverNotification, { type Presenter } from '@hcengineering/server-notification'
import { Type, type Static } from 'typebox'

import { buildClassSummary, buildSpaceSummary, ClassSummarySchema, SpaceSummarySchema } from '../shared'
import { objectLookupToolId } from './tool-ids'

const ObjectQueryFilterSchema = Type.Object(
  {
    key: Type.String({
      description: 'Object field key to filter by.'
    }),
    value: Type.Any({
      description: 'TxOperations.findAll query value for this field.'
    })
  },
  {
    description: 'Object query field value.'
  }
)

const ObjectQuerySortSchema = Type.Object(
  {
    key: Type.String({
      description: 'Object field key to sort by.'
    }),
    value: Type.Enum(['asc', 'desc'], {
      description: 'Sort direction.'
    })
  },
  {
    description: 'Object sort field direction.'
  }
)

export const ObjectLookupInputSchema = Type.Object(
  {
    classId: Type.String({
      description: 'Class or mixin identifier to list objects for.'
    }),
    query: Type.Optional(
      Type.Array(ObjectQueryFilterSchema, {
        description:
          'Optional TxOperations.findAll query by object fields. Each item is converted to a query record entry as key: value.'
      })
    ),
    sort: Type.Optional(
      Type.Array(ObjectQuerySortSchema, {
        description:
          'Optional TxOperations.findAll sort by object fields. Each item is converted to a sort record entry as key: asc/desc. Defaults to modifiedOn desc.'
      })
    ),
    limit: Type.Optional(
      Type.Number({
        default: 50,
        maximum: 200,
        description: 'Maximum number of lookup results. Defaults to 50.'
      })
    )
  },
  {
    description: 'Parameters for generic object lookup.'
  }
)

export const ObjectLookupOutputSchema = Type.Object(
  {
    results: Type.Array(
      Type.Object(
        {
          id: Type.String({
            description: 'Stable object identifier.'
          }),
          title: Type.String({
            description: 'Lookup result title.'
          }),
          class: ClassSummarySchema,
          space: SpaceSummarySchema
        },
        {
          description: 'Compact object lookup result.'
        }
      ),
      {
        description: 'Object lookup results.'
      }
    )
  },
  {
    description: 'Generic object lookup results.'
  }
)

type ObjectLookupInput = Static<typeof ObjectLookupInputSchema>
type ObjectLookupOutput = Static<typeof ObjectLookupOutputSchema>
type ObjectQueryEntry = Static<typeof ObjectQueryFilterSchema>
type ObjectSortEntry = Static<typeof ObjectQuerySortSchema>

type ObjectTitleProvider = (doc: Doc, space: Space | undefined) => Promise<string | undefined>

export const objectLookupTool = createTool({
  name: objectLookupToolId,
  description: 'List workspace objects by class or mixin, optionally filtering and sorting by object fields.',
  inputSchema: ObjectLookupInputSchema,
  outputSchema: ObjectLookupOutputSchema,
  execute: async (args: ObjectLookupInput, toolCtx: PlatformContext) => {
    const { hierarchy } = toolCtx

    const classId = args.classId as Ref<Class<Doc>>
    const limit = args.limit ?? 50
    const query = toQueryRecord(args.query)
    const sort = toSortRecord(args.sort)

    const docs = (await toolCtx.client.findAll(
      classId,
      query,
      {
        limit,
        sort,
        lookup: { space: core.class.Space }
      }
    )) as Array<WithLookup<Doc>>

    const titleProviders = [createTextPresenterTitleProvider(toolCtx, classId), createFallbackTitleProvider()]

    const output: ObjectLookupOutput = {
      results: await Promise.all(
        docs.map(async (doc) => {
          const docClass = doc._class as Ref<Class<Doc>>
          const classSummary = await buildClassSummary(hierarchy, docClass)
          const space = doc.$lookup?.space as Space | undefined

          return {
            id: doc._id,
            title: await getLookupTitle(titleProviders, doc, space),
            class: classSummary,
            space: buildSpaceSummary(doc.space, space)
          }
        })
      )
    }

    return toolOk(output)
  }
})

function toQueryRecord (query: ObjectQueryEntry[] | undefined): DocumentQuery<Doc> {
  return Object.fromEntries((query ?? []).map(({ key, value }) => [key, value])) as DocumentQuery<Doc>
}

function toSortRecord (sort: ObjectSortEntry[] | undefined): SortingQuery<Doc> {
  const entries = sort !== undefined && sort.length > 0 ? sort : [{ key: 'modifiedOn', value: 'desc' as const }]
  return Object.fromEntries(
    entries.map(({ key, value }) => [key, value === 'asc' ? SortingOrder.Ascending : SortingOrder.Descending])
  ) as SortingQuery<Doc>
}

async function getLookupTitle (providers: ObjectTitleProvider[], doc: Doc, space: Space | undefined): Promise<string> {
  for (const provider of providers) {
    const title = await provider(doc, space)
    if (title !== undefined && title.length > 0) {
      return title
    }
  }

  return doc._id
}

function createTextPresenterTitleProvider (toolCtx: PlatformContext, classId: Ref<Class<Doc>>): ObjectTitleProvider {
  const presenter = toolCtx.hierarchy.classHierarchyMixin(classId, serverNotification.mixin.TextPresenter)

  return async (doc) => {
    if (presenter === undefined) return undefined

    try {
      const fn = await getResource<Presenter>(presenter.presenter)
      // TODO this may not work because presenter requires TriggerControl
      // find a better way to generate title
      return await fn(doc, toolCtx as any)
    } catch (err) {
      toolCtx.ctx.warn('Failed to format text presenter title', errorLog(err, classId, doc))
      return undefined
    }
  }
}

function createFallbackTitleProvider (): ObjectTitleProvider {
  return async (doc) => {
    const title = (doc as any).title ?? (doc as any).name
    return typeof title === 'string' && title.length > 0 ? title : doc._id
  }
}

function errorLog (
  err: unknown,
  effectiveClass: Ref<Class<Doc>>,
  doc: Doc
): { error: string, class: string, id: string } {
  return {
    error: err instanceof Error ? err.message : String(err),
    class: effectiveClass,
    id: doc._id
  }
}
