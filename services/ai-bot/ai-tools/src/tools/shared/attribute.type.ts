//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import core, {
  Hierarchy,
  type Doc,
  type Ref,
  type Type as CoreType,
  type RefTo,
  type ArrOf,
  type Collection,
  type EnumOf,
  type ModelDb,
  type Enum
} from '@hcengineering/core'
import { Type, type Static } from 'typebox'
import { buildClassSummary, ClassSummarySchema } from './class.summary'

// export const PrimitiveTypeSchema = Type.Object({
//   kind: Type.String({
//     description: 'Attribute type kind, such as reference, enum, array, collection, or unknown.'
//   })
// })

export const AttributeTypeSchema = Type.Union(
  [
    Type.String({
      description:
        'Simple attribute type name, such as string, number, boolean, date, markup, or collaborative. Collaborative content is represented as HTML when exposed by card tools.'
    }),
    Type.Object(
      {
        kind: Type.String({
          description: 'Attribute type kind, such as reference, enum, array, collection, or unknown.'
        }),
        referenceOf: Type.Optional(
          Type.With(ClassSummarySchema, {
            description: 'Referenced class summary for reference attributes.'
          })
        ),
        collectionOf: Type.Optional(
          Type.With(ClassSummarySchema, {
            description: 'Referenced class summary for collection attributes.'
          })
        ),
        values: Type.Optional(
          Type.Array(Type.String({ description: 'Allowed enum value.' }), {
            description: 'Allowed values for enum attributes.'
          })
        ),
        items: Type.Optional(
          Type.Any({
            description: 'Item type descriptor for array attributes.'
          })
        )
      },
      {
        description: 'Detailed attribute type descriptor.'
      }
    )
  ],
  {
    description: 'Attribute type summary.'
  }
)

export type AttributeType = Static<typeof AttributeTypeSchema>

export async function buildAttributeType (
  hierarchy: Hierarchy,
  modelDb: ModelDb,
  type: CoreType<unknown>
): Promise<AttributeType> {
  const originalType = type._class as string

  switch (originalType) {
    case core.class.TypeString:
      return { kind: 'string' }
    case core.class.TypeNumber:
    case core.class.TypeFileSize:
      return { kind: 'number' }
    case core.class.TypeBoolean:
      return { kind: 'boolean' }
    case core.class.TypeDate:
    case core.class.TypeTimestamp:
      return { kind: 'date' }
    case core.class.TypeMarkup:
      return { kind: 'markup' }
    case core.class.TypeCollaborativeDoc:
      return { kind: 'collaborative' }
    case core.class.RefTo: {
      const refTo = type as RefTo<any>
      return {
        kind: 'reference',
        referenceOf: refTo.to !== undefined ? await buildClassSummary(hierarchy, refTo.to) : undefined
      }
    }
    case core.class.ArrOf: {
      const arrOf = type as ArrOf<Doc>
      return { kind: 'array', items: await buildAttributeType(hierarchy, modelDb, arrOf.of) }
    }
    case core.class.Collection: {
      const collectionOf = type as Collection<any>
      return {
        kind: 'collection',
        collectionOf: await buildClassSummary(hierarchy, collectionOf.of)
      }
    }
    case core.class.EnumOf: {
      const enumOf = type as EnumOf
      const values = enumOf.of !== undefined ? getEnumValues(modelDb, enumOf.of) : undefined
      return { kind: 'enum', values }
    }
    default:
      return { kind: 'unknown' }
  }
}

function getEnumValues (modelDb: ModelDb, id: Ref<Enum>): string[] | undefined {
  const doc = modelDb.findObject<Enum>(id)
  return doc?.enumValues
}
