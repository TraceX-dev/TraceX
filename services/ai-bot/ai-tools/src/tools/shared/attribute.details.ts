//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext } from '@hcengineering/ai-core'
import { type AnyAttribute } from '@hcengineering/core'
import { translate } from '@hcengineering/platform'
import { Type, type Static } from 'typebox'
import { AttributeTypeSchema, buildAttributeType } from './attribute.type'
import { isReadonlyAttribute, isSystemAttribute } from '../card/utils'

export const AttributeDetailsSchema = Type.Object(
  {
    key: Type.String({
      description: 'Stable attribute key.'
    }),
    label: Type.String({
      description: 'Human-readable attribute label.'
    }),
    type: Type.With(AttributeTypeSchema, {
      description: 'Attribute type summary.'
    }),
    system: Type.Boolean({
      description: 'Whether this is a system attribute that should normally not be set by agents.'
    }),
    readonly: Type.Boolean({
      description: 'Whether this attribute is readonly.'
    }),
    required: Type.Boolean({
      description: 'Whether this attribute is required.'
    }),
    hidden: Type.Boolean({
      description: 'Whether this attribute is hidden from regular card UI.'
    })
  },
  {
    description: 'Attribute details.'
  }
)

export type AttributeDetails = Static<typeof AttributeDetailsSchema>

export async function buildAttributeDetails (toolCtx: PlatformContext, attr: AnyAttribute): Promise<AttributeDetails> {
  const { hierarchy, model } = toolCtx
  return {
    key: attr.name,
    type: await buildAttributeType(hierarchy, model, attr.type),
    label: await translate(attr.label, {}),
    system: isSystemAttribute(attr),
    readonly: isReadonlyAttribute(attr),
    required: attr.required ?? false,
    hidden: attr.hidden ?? false
  }
}
