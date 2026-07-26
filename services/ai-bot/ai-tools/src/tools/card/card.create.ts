//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext, createTool, toolFail, toolOk } from '@hcengineering/ai-core'
import card, { type Card, type CardSpace, type MasterTag, type Tag } from '@hcengineering/card'
import core, {
  fillDefaults,
  generateId,
  MarkupBlobRef,
  type Class,
  type Data,
  type Doc,
  type Hierarchy,
  type Ref
} from '@hcengineering/core'
import { Type } from 'typebox'
import { cardMasterTagDetailsTool } from './card.master_tag_details'
import { cardCreateToolId, cardListMasterTagsToolId, cardListSpacesToolId } from './tool-ids'
import { isCollaborativeAttribute } from './utils'
import { AttributeUpdateSchema, createCardContentRef } from '../shared'

export const CreateCardInputSchema = Type.Object(
  {
    spaceId: Type.String({
      description: `Stable card space identifier returned by ${cardListSpacesToolId}.`
    }),
    masterTagId: Type.String({
      description: `Stable master tag identifier returned by ${cardListMasterTagsToolId}.`
    }),
    title: Type.String({
      description: 'Card title.'
    }),
    content: Type.Optional(
      Type.String({
        description: 'Initial card collaborative content as HTML.'
      })
    ),
    parentId: Type.Optional(
      Type.String({
        description: 'Optional parent card identifier.'
      })
    ),
    attributes: Type.Optional(
      Type.Array(AttributeUpdateSchema, {
        description:
          'Master tag attribute values. Use only attribute ids from masterTag.attributes. Collaborative attributes are not accepted here; use top-level content for card content HTML.'
      })
    ),
    tags: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({
              description: `Stable tag identifier returned by ${cardMasterTagDetailsTool.name} tags.`
            }),
            attributes: Type.Optional(
              Type.Array(AttributeUpdateSchema, {
                description:
                  'Tag attribute values. Use only attribute ids from this tag attributes. Collaborative attributes are not accepted here; exposed collaborative content values are HTML.'
              })
            )
          },
          {
            description: 'Tag mixin to assign to the new card.'
          }
        ),
        {
          description: 'Tag mixins to assign to the new card.'
        }
      )
    )
  },
  {
    description: 'Parameters for creating a card.'
  }
)

export const CreateCardOutputSchema = Type.Object(
  {
    id: Type.String({
      description: 'Stable identifier of the created card.'
    })
  },
  {
    description: 'Created card identifier.'
  }
)

export const cardCreateTool = createTool({
  name: cardCreateToolId,
  description:
    'Create a card. Card collaborative content goes to top-level content as HTML. Master attributes go to attributes; tag mixins are assigned with tags[].attributes.',
  inputSchema: CreateCardInputSchema,
  outputSchema: CreateCardOutputSchema,
  execute: async (args, toolCtx: PlatformContext) => {
    const { client, hierarchy } = toolCtx

    const spaceId = args.spaceId as Ref<CardSpace>
    const masterTagId = args.masterTagId as Ref<MasterTag>
    const parentId = args.parentId as Ref<Card> | undefined
    const attributes = args.attributes ?? []
    const tags = args.tags ?? []

    const space = await client.findOne(card.class.CardSpace, { _id: spaceId })
    if (space === undefined) {
      return toolFail('Card space not found', 'invalid_space_id')
    }

    const masterTag = await client.findOne(card.class.MasterTag, { _id: masterTagId })
    if (masterTag === undefined || !space.types.includes(masterTagId)) {
      return toolFail('Master tag not found', 'invalid_master_tag_id')
    }

    const cardId = generateId<Card>()
    const { title } = args

    const data: Data<Card> = {
      title,
      rank: '',
      blobs: {},
      parentInfo: [],
      content: '' as MarkupBlobRef
    }

    // Handle ParentInfo

    if (parentId !== undefined) {
      const parent = await client.findOne(card.class.Card, { _id: parentId })
      if (parent === undefined) {
        return toolFail('Parent not found', 'invalid_parent_id')
      }
      data.parentInfo = [
        ...(parent.parentInfo ?? []),
        {
          _id: parent._id,
          _class: parent._class,
          title: parent.title
        }
      ]
    }

    // Handle MasterTag attributes

    const allAttributes = hierarchy.getAllAttributes(masterTagId, core.class.Doc)

    for (const attr of attributes) {
      if (!allAttributes.has(attr.key)) {
        return toolFail(`Attribute not found: ${attr.key}`, 'invalid_attribute')
      }
      const attribute = allAttributes.get(attr.key)
      if (attribute !== undefined && isCollaborativeAttribute(attribute)) {
        return toolFail(`Collaborative attribute is not supported in attributes: ${attr.key}`, 'invalid_attribute')
      }
      ;(data as any)[attr.key] = attr.value
    }

    // Handle Tag mixin attributes

    const tagMixins = new Map<Ref<Tag>, Record<string, unknown>>()
    const ancestors = hierarchy.getAncestors(masterTagId)
    for (const tag of tags) {
      const tagId = tag.id as Ref<Tag>
      if (tagMixins.has(tagId)) {
        return toolFail(`Duplicate tag ${tagId}`, 'duplicate_tag_id')
      }

      const tagDoc = await client.findOne(card.class.Tag, { _id: tagId })
      if (tagDoc === undefined) {
        return toolFail(`Tag ${tagId} not found`, 'invalid_tag_id')
      }
      if (!isPossibleMixin(hierarchy, masterTagId, ancestors, tagId)) {
        return toolFail(`Tag ${tagId} is not applicable to master tag ${masterTagId}`, 'invalid_tag_id')
      }

      const tagAttributes = hierarchy.getOwnAttributes(tagId)
      const data: Record<string, unknown> = {}
      for (const attr of tag.attributes ?? []) {
        if (!tagAttributes.has(attr.key)) {
          return toolFail(`Attribute not found for tag ${tagId}: ${attr.key}`, 'invalid_attribute')
        }
        const attribute = tagAttributes.get(attr.key)
        if (attribute !== undefined && isCollaborativeAttribute(attribute)) {
          return toolFail(`Collaborative attribute is not supported for tag ${tagId}: ${attr.key}`, 'invalid_attribute')
        }
        data[attr.key] = attr.value
      }
      tagMixins.set(tagId, data)
    }

    try {
      data.content = await createCardContentRef(toolCtx, masterTagId, cardId, args.content)
    } catch {
      return toolFail('Could not create card collaborative content', 'collaborative_content_failed')
    }

    const dataWithDefaults = fillDefaults(hierarchy, data, masterTagId)
    await client.createDoc(masterTagId, spaceId, dataWithDefaults, cardId)

    for (const [tagId, tagData] of tagMixins) {
      await client.createMixin(cardId, masterTagId, spaceId, tagId, tagData as any)
    }

    const result = { id: cardId }
    return toolOk(result)
  }
})

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
