//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { PlatformContext, Tool } from '@hcengineering/ai-core'
import { cardTools } from './tools/card'
import { fulltextTools } from './tools/fulltext'
import { objectTools } from './tools/object'

export { cardTools } from './tools/card'
export { fulltextTools } from './tools/fulltext'
export { objectTools } from './tools/object'

export const tools: Tool<any, any, PlatformContext, any>[] = [...cardTools, ...fulltextTools, ...objectTools]
