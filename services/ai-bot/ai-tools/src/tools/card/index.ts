//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { cardCreateTool } from './card.create'
import { cardGetTool } from './card.get'
import { cardListSpacesTool } from './card.list_spaces'
import { cardMasterTagDetailsTool } from './card.master_tag_details'
import { cardListMasterTagsTool } from './card.master_tag_list'
import { cardSearchTool } from './card.search'
import { cardUpdateTool } from './card.update'

export const cardTools = [
  cardListSpacesTool,
  cardListMasterTagsTool,
  cardMasterTagDetailsTool,
  cardGetTool,
  cardSearchTool,
  cardCreateTool,
  cardUpdateTool
]
