//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext, createTool, toolOk } from '@hcengineering/ai-core'
import card from '@hcengineering/card'
import { Type } from 'typebox'
import { ClassSummarySchema, buildClassSummary } from '../shared/class.summary'
import { cardListSpacesToolId } from './tool-ids'

export const ListSpacesInputSchema = Type.Object(
  {
    includeArchived: Type.Optional(
      Type.Boolean({
        description: 'Include archived card spaces. Defaults to false.'
      })
    )
  },
  {
    description: 'Parameters for listing card spaces available in the current workspace.'
  }
)

export const ListSpacesOutputSchema = Type.Object(
  {
    spaces: Type.Array(
      Type.Object(
        {
          id: Type.String({
            description: 'Stable card space identifier.'
          }),
          name: Type.String({
            description: 'Human-readable card space name.'
          }),
          private: Type.Optional(
            Type.Boolean({
              description: 'Whether the card space is private.'
            })
          ),
          archived: Type.Optional(
            Type.Boolean({
              description: 'Whether the card space is archived.'
            })
          ),
          members: Type.Optional(
            Type.Array(Type.String({ description: 'Workspace account identifier.' }), {
              description: 'Workspace members assigned to the private card space.'
            })
          ),
          types: Type.Array(
            Type.With(ClassSummarySchema, {
              description: 'Card master tag available in this space.'
            }),
            {
              description: 'Master tags that can be used to create cards in this space.'
            }
          )
        },
        {
          description: 'Card space summary.'
        }
      ),
      {
        description: 'Card spaces visible in the workspace.'
      }
    )
  },
  {
    description: 'List of card spaces.'
  }
)

export const cardListSpacesTool = createTool({
  name: cardListSpacesToolId,
  description: 'List card spaces visible in the workspace.',
  inputSchema: ListSpacesInputSchema,
  outputSchema: ListSpacesOutputSchema,
  execute: async (args, toolCtx: PlatformContext) => {
    const { client, hierarchy } = toolCtx

    const includeArchived = args.includeArchived === true
    const query = includeArchived ? {} : { archived: false }
    const spaces = await client.findAll(card.class.CardSpace, query)

    const result = []
    for (const space of spaces) {
      const types = []
      if (space.types !== undefined) {
        for (const type of space.types) {
          types.push(await buildClassSummary(hierarchy, type))
        }

        result.push({
          id: space._id,
          name: space.name,
          private: space.private,
          archived: space.archived,
          members: space.members,
          types
        })
      }
    }

    return toolOk({ spaces: result })
  }
})
