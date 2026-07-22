//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { Type, type Static } from 'typebox'

export const AttributeUpdateSchema = Type.Object(
  {
    key: Type.String({
      description: 'Stable attribute key returned by card.master_tag_details.'
    }),
    value: Type.Any({
      description: 'Attribute value. The value shape must match the attribute type from card.master_tag_details.'
    })
  },
  {
    description: 'Attribute value.'
  }
)

export type AttributeUpdate = Static<typeof AttributeUpdateSchema>
