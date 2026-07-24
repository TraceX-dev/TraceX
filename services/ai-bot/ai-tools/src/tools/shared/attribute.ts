//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type PlatformContext } from '@hcengineering/ai-core'
import { type AnyAttribute, type Doc, type Hierarchy, type Mixin, type Ref } from '@hcengineering/core'
import { translate } from '@hcengineering/platform'
import { Type, type Static } from 'typebox'

export const AttributeSchema = Type.Object(
  {
    key: Type.String({
      description: 'Stable attribute key.'
    }),
    label: Type.String({
      description: 'Human-readable attribute name.'
    }),
    value: Type.Optional(
      Type.Any({
        description: 'Current attribute value.'
      })
    )
  },
  {
    description: 'Attribute value.'
  }
)

export type AttributeValue = Static<typeof AttributeSchema>

export async function buildAttribute (toolCtx: PlatformContext, doc: Doc, attr: AnyAttribute): Promise<AttributeValue> {
  const { hierarchy } = toolCtx
  return {
    key: attr.name,
    label: await translate(attr.label, {}),
    value: readAttributeValue(hierarchy, doc, attr)
  }
}

function readAttributeValue (hierarchy: Hierarchy, doc: Doc, attr: AnyAttribute): unknown {
  if (hierarchy.isMixin(attr.attributeOf)) {
    const tagValue = hierarchy.as(doc, attr.attributeOf as Ref<Mixin<Doc>>) as any
    return tagValue?.[attr.name] ?? null
  }

  return (doc as any)[attr.name] ?? null
}
