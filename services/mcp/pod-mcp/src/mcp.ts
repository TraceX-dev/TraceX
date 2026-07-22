//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import type { CallToolResult } from '@modelcontextprotocol/server'

export interface ToolResult {
  content: Array<{ type: 'text', text: string }>
  structuredContent?: unknown
  isError?: boolean
}

export function jsonText (value: unknown, isError: boolean = false): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ],
    ...(isError ? { isError } : {})
  }
}

export function jsonStructuredText (value: unknown): CallToolResult {
  return {
    ...jsonText(value),
    structuredContent: value
  }
}
