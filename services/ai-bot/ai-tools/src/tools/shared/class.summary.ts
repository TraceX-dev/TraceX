//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type Class, type Doc, type Hierarchy, type Ref } from '@hcengineering/core'
import { translate } from '@hcengineering/platform'
import { Type, type Static } from 'typebox'

export const ClassSummarySchema = Type.Object(
  {
    id: Type.String({
      description: 'Stable class identifier.'
    }),
    name: Type.String({
      description: 'Human-readable class name.'
    })
  },
  {
    description: 'Class summary.'
  }
)

export type ClassSummary = Static<typeof ClassSummarySchema>

export async function buildClassSummary (hierarchy: Hierarchy, id: Ref<Class<Doc>>): Promise<ClassSummary> {
  const clazz = hierarchy.getClass(id)
  const name = (await translate(clazz.label, {})) ?? id
  return { id, name }
}
