//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext, createTool, toolFail, toolOk } from '@hcengineering/ai-core'
import card, { type Card, type CardSpace, type Tag } from '@hcengineering/card'
import { type Ref, type TxOperations } from '@hcengineering/core'
import { Type, type Static } from 'typebox'
import { cardCreateToolId, cardGetToolId, cardSearchToolId } from './tool-ids'
import { attributesForOwner } from './utils'
import {
  AttributeSchema,
  buildAttribute,
  buildClassSummary,
  buildSpaceSummary,
  ClassSummarySchema,
  SpaceSummarySchema
} from '../shared'

export const GetCardInputSchema = Type.Object(
  {
    cardId: Type.String({
      description: `Stable card identifier returned by ${cardSearchToolId} or ${cardCreateToolId}.`
    })
  },
  {
    description: 'Parameters for loading a card.'
  }
)

type GetCardArgs = Static<typeof GetCardInputSchema>

const GetCardOutputTagSchema = Type.Union(
  [
    Type.With(ClassSummarySchema, {
      description: 'Card tag summary.'
    }),
    Type.Object(
      {
        attributes: Type.Array(AttributeSchema, {
          description: 'Attribute values owned by this active tag mixin.'
        })
      },
      {
        description: 'Active tag attribute values.'
      }
    )
  ],
  {
    description: 'Active tag mixin on the card.'
  }
)

const GetCardOutputSchema = Type.Object(
  {
    id: Type.String({
      description: 'Stable card identifier.'
    }),
    masterTag: Type.With(ClassSummarySchema, {
      description: 'Card master tag summary.'
    }),
    title: Type.String({
      description: 'Card title.'
    }),
    space: Type.With(SpaceSummarySchema, {
      description: 'Card space summary.'
    }),
    parent: Type.Optional(
      Type.Union(
        [Type.String({ description: 'Parent card identifier.' }), Type.Null({ description: 'No parent card is set.' })],
        {
          description: 'Parent card identifier, null, or omitted when no parent is set.'
        }
      )
    ),
    readonly: Type.Optional(
      Type.Boolean({
        description: 'Whether the card is readonly.'
      })
    ),
    version: Type.Object(
      {
        baseId: Type.Optional(
          Type.String({
            description: 'Base document identifier for versioned cards.'
          })
        ),
        version: Type.Optional(
          Type.Number({
            description: 'Card document version number.'
          })
        ),
        isLatest: Type.Optional(
          Type.Boolean({
            description: 'Whether this card is the latest version.'
          })
        ),
        docCreatedBy: Type.Optional(
          Type.String({
            description: 'Account identifier that created this document version.'
          })
        )
      },
      {
        description: 'Card document version metadata.'
      }
    ),
    tags: Type.Array(GetCardOutputTagSchema, {
      description: 'Active tag mixins on the card.'
    }),
    attributes: Type.Array(AttributeSchema, {
      description: 'Master tag attribute values on the card.'
    })
  },
  {
    description: 'Card details with master attributes and active tag attributes.'
  }
)

export const cardGetTool = createTool({
  name: cardGetToolId,
  description: 'Get a card with compact attribute values.',
  inputSchema: GetCardInputSchema,
  outputSchema: GetCardOutputSchema,
  execute: async (args: GetCardArgs, toolCtx: PlatformContext) => {
    const { client, hierarchy } = toolCtx
    const doc = await client.findOne(card.class.Card, { _id: args.cardId as Ref<Card> })
    if (doc === undefined) {
      return toolFail('Card not found', 'card_not_found')
    }

    const tags = await getActiveTags(client, doc)
    const space = await client.findOne(card.class.CardSpace, { _id: doc.space as Ref<CardSpace> })
    const attributes = await Promise.all(
      attributesForOwner(toolCtx, doc._class, false, true).map((attr) => buildAttribute(toolCtx, doc, attr))
    )

    const result = {
      id: doc._id,
      masterTag: await buildClassSummary(hierarchy, doc._class),
      title: doc.title,
      space: buildSpaceSummary(doc.space, space),
      parent: doc.parent,
      readonly: doc.readonly,
      version: {
        baseId: doc.baseId,
        version: doc.version,
        isLatest: doc.isLatest,
        docCreatedBy: doc.docCreatedBy
      },
      tags: await Promise.all(
        tags.map(async (tag) => ({
          ...(await buildClassSummary(hierarchy, tag._id)),
          attributes: await Promise.all(
            attributesForOwner(toolCtx, tag._id, false, true).map((attr) => buildAttribute(toolCtx, doc, attr))
          )
        }))
      ),
      attributes
    }

    return toolOk(result)
  }
})

async function getActiveTags (client: TxOperations, doc: Card): Promise<Tag[]> {
  const hierarchy = client.getHierarchy()
  const tags = await client.findAll(card.class.Tag, {})
  return tags.filter((tag) => hierarchy.hasMixin(doc, tag._id))
}
