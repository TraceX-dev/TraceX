//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext, ToolError, createTool, toolFail, toolOk } from '@hcengineering/ai-core'
import card, { type Card, type MasterTag, type Tag } from '@hcengineering/card'
import core, { Hierarchy, type Class, type Data, type Doc, type Mixin, type Ref } from '@hcengineering/core'
import { Type, type Static } from 'typebox'
import { cardCreateToolId, cardMasterTagDetailsToolId, cardSearchToolId, cardUpdateToolId } from './tool-ids'
import { isCollaborativeAttribute } from './utils'
import { AttributeUpdateSchema, updateCardContentHtml } from '../shared'

const TagUpdateSchema = Type.Object(
  {
    id: Type.String({
      description: `Stable tag identifier returned by ${cardMasterTagDetailsToolId}.`
    }),
    attributes: Type.Optional(
      Type.Array(AttributeUpdateSchema, {
        description:
          'Tag attribute updates. If the tag is not active, it will be added with these values. Collaborative attributes are not accepted here; exposed collaborative content values are HTML.'
      })
    )
  },
  {
    description: 'Tag mixin add, update, or remove operation.'
  }
)

export const UpdateCardInputSchema = Type.Object(
  {
    cardId: Type.String({
      description: `Stable card identifier returned by ${cardSearchToolId} or ${cardCreateToolId}.`
    }),
    title: Type.Optional(
      Type.String({
        description: 'New card title.'
      })
    ),
    content: Type.Optional(
      Type.String({
        description: 'New card collaborative content as HTML.'
      })
    ),
    attributes: Type.Optional(
      Type.Array(AttributeUpdateSchema, {
        description:
          'Master tag attribute updates. Use only attribute keys from masterTag.attributes. Collaborative attributes are not accepted here; use top-level content for card content HTML.'
      })
    ),
    tags: Type.Optional(
      Type.Array(TagUpdateSchema, {
        description: 'Tag mixin operations and tag attribute updates.'
      })
    )
  },
  {
    description: 'Parameters for updating a card.'
  }
)

export const UpdateCardOutputSchema = Type.Object(
  {
    id: Type.Optional(
      Type.String({
        description: 'Updated card identifier.'
      })
    ),
    updated: Type.Optional(
      Type.Boolean({
        description: 'Whether the card update completed successfully.'
      })
    ),
    cardId: Type.Optional(
      Type.String({
        description: 'Card identifier related to an error response.'
      })
    ),
    error: Type.Optional(
      Type.String({
        description: 'Machine-readable error code when the update could not be applied.'
      })
    ),
    message: Type.Optional(
      Type.String({
        description: 'Human-readable error details.'
      })
    )
  },
  {
    description: 'Card update result.'
  }
)

type AttributeUpdate = Static<typeof AttributeUpdateSchema>
type TagUpdate = Static<typeof TagUpdateSchema>
type UpdateCardInput = Static<typeof UpdateCardInputSchema>
type CardDataUpdate = Partial<Data<Card>>

export const cardUpdateTool = createTool({
  name: cardUpdateToolId,
  description:
    'Update a card. Card collaborative content goes to top-level content as HTML. Master attributes go to attributes; tag mixins are added, updated, or removed with tags[].',
  inputSchema: UpdateCardInputSchema,
  outputSchema: UpdateCardOutputSchema,
  execute: async (args: UpdateCardInput, toolCtx: PlatformContext) => {
    const { client, hierarchy } = toolCtx
    const cardId = args.cardId as Ref<Card>

    const doc = await toolCtx.client.findOne(card.class.Card, { _id: cardId })
    if (doc === undefined) {
      return toolFail(`Card not found: ${cardId}`, 'card_not_found')
    }

    if (doc.readonly === true || doc.isLatest === false) {
      return toolFail('Card is readonly', 'readonly_card')
    }

    const update: Partial<Data<Card>> = {}

    // TODO handle readonly fields

    if (typeof args.title === 'string') {
      update.title = args.title
    }

    const attributes = args.attributes ?? []

    const allAttributes = hierarchy.getAllAttributes(doc._class, core.class.Doc)

    for (const attr of attributes) {
      if (!allAttributes.has(attr.key)) {
        return toolFail(`Attribute ${attr.key} not found`, 'attribute_not_found')
      }
      const attribute = allAttributes.get(attr.key)
      if (attribute !== undefined && isCollaborativeAttribute(attribute)) {
        return toolFail(`Collaborative attribute ${attr.key} is not supported in attributes`, 'attribute_not_found')
      }
      ;(update as any)[attr.key] = attr.value
    }

    if (typeof args.content === 'string') {
      try {
        const contentRef = await updateCardContentHtml(toolCtx, doc, args.content)
        if (contentRef !== undefined) {
          update.content = contentRef
        }
      } catch {
        return toolFail('Could not update card collaborative content', 'collaborative_content_failed')
      }
    }

    await client.diffUpdate(doc, update)

    const ancestors = hierarchy.getAncestors(doc._class)
    for (const tagUpdate of args.tags ?? []) {
      await applyTagUpdate(toolCtx, doc, ancestors, tagUpdate)
    }

    return toolOk({ id: cardId, updated: true })
  }
})

function prepareTagAttributes (toolCtx: PlatformContext, tagId: Ref<Tag>, updates: AttributeUpdate[]): CardDataUpdate {
  const tagAttributes = toolCtx.hierarchy.getOwnAttributes(tagId)
  const tagData: CardDataUpdate = {}

  for (const attr of updates) {
    if (!tagAttributes.has(attr.key)) {
      throw new ToolError(`Attribute ${attr.key} not found for tag ${tagId}`, 'attribute_not_found')
    }
    const attribute = tagAttributes.get(attr.key)
    if (attribute !== undefined && isCollaborativeAttribute(attribute)) {
      throw new ToolError(
        `Collaborative attribute ${attr.key} is not supported for tag ${tagId}`,
        'attribute_not_found'
      )
    }
    ;(tagData as any)[attr.key] = attr.value
  }

  return tagData
}

async function applyTagUpdate (
  toolCtx: PlatformContext,
  doc: Card,
  ancestors: Array<Ref<Class<Doc>>>,
  tagUpdate: TagUpdate
): Promise<void> {
  const { hierarchy } = toolCtx

  const tagId = tagUpdate.id as Ref<Tag>

  if (!isPossibleMixin(hierarchy, doc._class, ancestors, tagId)) {
    throw new ToolError(`Tag ${tagId} is not applicable to master tag ${doc._class}`, 'invalid_tag')
  }

  const data = prepareTagAttributes(toolCtx, tagId, tagUpdate.attributes ?? [])
  if (Object.keys(data).length > 0) {
    toolCtx.hierarchy.hasMixin(doc, tagId)
      ? await toolCtx.client.updateMixin(doc._id, doc._class, doc.space, tagId as Ref<Mixin<Card>>, data)
      : await toolCtx.client.createMixin(doc._id, doc._class, doc.space, tagId, data)
  }
}

function isPossibleMixin (
  hierarchy: Hierarchy,
  masterTagId: Ref<MasterTag>,
  ancestors: Array<Ref<Class<Doc>>>,
  tagId: Ref<Tag>
): boolean {
  try {
    const base = hierarchy.getBaseClass(tagId)
    return masterTagId === base || ancestors.includes(base)
  } catch {
    return false
  }
}
