//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext, createTool, toolFail, toolOk } from '@hcengineering/ai-core'
import card, { type CardSpace } from '@hcengineering/card'
import core, { ClassifierKind, type Ref } from '@hcengineering/core'
import { translate } from '@hcengineering/platform'
import { Type } from 'typebox'
import { cardListMasterTagsToolId } from './tool-ids'

export const ListMasterTagsInputSchema = Type.Object(
  {
    spaceId: Type.Optional(
      Type.String({
        description: 'Optional card space identifier used to return only master tags allowed in that space.'
      })
    )
  },
  {
    description: 'Parameters for listing card master tags.'
  }
)

export const ListMasterTagsOutputSchema = Type.Object(
  {
    types: Type.Array(
      Type.Object(
        {
          id: Type.String({
            description: 'Stable master tag identifier.'
          }),
          label: Type.String({
            description: 'Human-readable master tag label.'
          }),
          removed: Type.Boolean({
            description: 'Whether the master tag has been removed.'
          }),
          versioning: Type.Object(
            {
              enabled: Type.Boolean({
                description: 'Whether cards of this master tag support document versioning.'
              })
            },
            {
              description: 'Versioning settings for this master tag.'
            }
          )
        },
        {
          description: 'Card master tag summary.'
        }
      ),
      {
        description: 'Available card master tags.'
      }
    )
  },
  {
    description: 'List of available card master tags.'
  }
)

export const cardListMasterTagsTool = createTool({
  name: cardListMasterTagsToolId,
  description: 'List available card master tags, optionally filtered by card space.',
  inputSchema: ListMasterTagsInputSchema,
  outputSchema: ListMasterTagsOutputSchema,
  execute: async (args, toolCtx: PlatformContext) => {
    const { client, hierarchy } = toolCtx

    const spaceId = args.spaceId as Ref<CardSpace> | undefined

    let space: CardSpace | undefined
    if (spaceId !== undefined) {
      space = await client.findOne(card.class.CardSpace, { _id: spaceId })
      if (space === undefined) {
        return toolFail('Card space not found', 'invalid_space_id')
      }
    }

    const query = {
      extends: card.class.Card,
      kind: ClassifierKind.CLASS,
      removed: { $ne: true },
      ...(space !== undefined && space.types.length > 0 ? { _id: { $in: space.types } } : {})
    }
    const masterTags = await client.findAll(card.class.MasterTag, query)
    const types = await Promise.all(
      masterTags.map(async (p) => {
        const versionable = hierarchy.classHierarchyMixin(p._id, core.mixin.VersionableClass)
        return {
          id: p._id,
          label: await translate(p.label, {}),
          removed: p.removed === true,
          versioning: {
            enabled: versionable?.enabled ?? false
          }
        }
      })
    )

    return toolOk({ types })
  }
})
