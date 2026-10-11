//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { jsonStructuredText, jsonText } from '../mcp'

describe('mcp tool results', () => {
  it('returns structured content alongside JSON text', () => {
    const output = { results: [{ id: 'card-1', title: 'Card 1' }] }

    expect(jsonStructuredText(output)).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(output, null, 2)
        }
      ],
      structuredContent: output
    })
  })

  it('does not add structured content to tool errors', () => {
    const output = { error: { code: 'tool_error', message: 'Failed' } }

    expect(jsonText(output, true)).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(output, null, 2)
        }
      ],
      isError: true
    })
  })
})
