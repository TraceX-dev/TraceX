//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext, createTool, toolFail, toolOk } from '@hcengineering/ai-core'
import card, { type MasterTag, type Tag } from '@hcengineering/card'
import core, { type Hierarchy, type Ref, type TxOperations } from '@hcengineering/core'
import { translate } from '@hcengineering/platform'
import { Type } from 'typebox'
import { cardCreateToolId, cardListMasterTagsToolId, cardMasterTagDetailsToolId, cardUpdateToolId } from './tool-ids'
import { AttributeDetailsSchema, buildAttributeDetails } from '../shared'
import { isCollaborativeAttribute } from './utils'

export const MasterTagDetailsInputSchema = Type.Object(
  {
    masterTagId: Type.String({
      description: `Stable master tag identifier returned by ${cardListMasterTagsToolId}.`
    })
  },
  {
    description: 'Parameters for loading card master tag details.'
  }
)

export const MasterTagDetailsOutputSchema = Type.Object(
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
    ),
    attributes: Type.Array(AttributeDetailsSchema, {
      description:
        'Attributes owned by the master tag. Use these ids in top-level card attributes. Collaborative attributes are omitted; card content is exposed as top-level HTML content.'
    }),
    tags: Type.Array(
      Type.Object(
        {
          id: Type.String({
            description: `Stable tag identifier to use in ${cardCreateToolId} and ${cardUpdateToolId} tags.`
          }),
          label: Type.String({
            description: 'Human-readable tag label.'
          }),
          removed: Type.Boolean({
            description: 'Whether the tag has been removed.'
          }),
          attributes: Type.Array(AttributeDetailsSchema, {
            description:
              'Attributes owned by this tag. Use these ids inside the matching tag attributes. Collaborative attributes are omitted; exposed collaborative content values are HTML.'
          })
        },
        {
          description: 'Applicable tag mixin for this master tag.'
        }
      ),
      {
        description: 'Tag mixins that can be assigned to cards of this master tag.'
      }
    )
  },
  {
    description: 'Master tag details including master attributes and applicable tag mixins.'
  }
)

export const cardMasterTagDetailsTool = createTool({
  name: cardMasterTagDetailsToolId,
  description:
    'Returns master tag details, including master attributes and applicable tag mixins with their attributes. Collaborative attributes are omitted; card content is HTML in top-level content fields.',
  inputSchema: MasterTagDetailsInputSchema,
  outputSchema: MasterTagDetailsOutputSchema,
  execute: async (args, toolCtx: PlatformContext) => {
    const { client, hierarchy } = toolCtx

    const masterTagId = args.masterTagId as Ref<MasterTag>

    const masterTag = await client.findOne(card.class.MasterTag, { _id: masterTagId })
    if (masterTag === undefined) {
      return toolFail('Master tag not found', 'invalid_master_tag_id')
    }

    const versionable = hierarchy.classHierarchyMixin(masterTag._id, core.mixin.VersionableClass)
    const attributes = hierarchy.getAllAttributes(masterTagId, core.class.Doc)
    const tags = await getApplicableTags(client, hierarchy, masterTagId)

    const result = {
      id: masterTag._id,
      label: await translate(masterTag.label, {}),
      removed: masterTag.removed === true,
      versioning: {
        enabled: versionable?.enabled ?? false
      },
      attributes: await Promise.all(
        attributes
          .entries()
          .filter(([, attr]) => !isCollaborativeAttribute(attr))
          .map(([, attr]) => buildAttributeDetails(toolCtx, attr))
          .toArray()
      ),
      tags: await Promise.all(
        tags.map(async (tag) => ({
          id: tag._id,
          label: await translate(tag.label, {}),
          removed: tag.removed === true,
          attributes: await Promise.all(
            hierarchy
              .getOwnAttributes(tag._id)
              .entries()
              .filter(([, attr]) => !isCollaborativeAttribute(attr))
              .map(([, attr]) => buildAttributeDetails(toolCtx, attr))
              .toArray()
          )
        }))
      )
    }

    return toolOk(result)
  }
})

async function getApplicableTags (
  client: TxOperations,
  hierarchy: Hierarchy,
  masterTagId: Ref<MasterTag>
): Promise<Tag[]> {
  const tags = await client.findAll(card.class.Tag, {})
  const ancestors = hierarchy.getAncestors(masterTagId)
  const result: Tag[] = []

  for (const tag of tags) {
    try {
      const base = hierarchy.getBaseClass(tag._id)
      if (masterTagId === base || ancestors.includes(base)) {
        result.push(tag)
      }
    } catch {
      // ignore malformed / stale mixins
    }
  }

  return result
}
