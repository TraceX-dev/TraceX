//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type Space, type Ref } from '@hcengineering/core'
import { Type, type Static } from 'typebox'

export const SpaceSummarySchema = Type.Object(
  {
    id: Type.String({
      description: 'Stable space identifier.'
    }),
    name: Type.String({
      description: 'Human-readable space name.'
    })
  },
  {
    description: 'Space summary.'
  }
)

export type SpaceSummary = Static<typeof SpaceSummarySchema>

export function buildSpaceSummary (spaceId: Ref<Space>, space: Space | undefined): SpaceSummary {
  return {
    id: spaceId,
    name: space?.name ?? spaceId
  }
}
