//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { MeasureMetricsContext } from '@hcengineering/core'
import { Type } from 'typebox'

import { createTool, toolOk, toolFail, renderToolResult } from '../tools'

const GetWeatherInputSchema = Type.Object({
  location: Type.String({})
})

const GetWeatherOutputSchema = Type.Object({
  temperature: Type.Number({})
})

describe('createTool', () => {
  const ctx = new MeasureMetricsContext('text', {})

  const getWeatherTool = createTool({
    name: 'get-weather',
    description: 'Get weather tool tool',
    inputSchema: GetWeatherInputSchema,
    outputSchema: GetWeatherOutputSchema,
    execute: async ({ location }) => {
      switch (location) {
        case 'Paris':
          return toolOk({ temperature: 25.0 })
        case 'London':
          return toolOk({ temperature: 25.0 })
        default:
          return toolFail('Unknown location', 'unknown_location')
      }
    }
  })

  it('returns weather for known location', async () => {
    const result = await getWeatherTool.execute({ location: 'London' }, { ctx })
    expect(result).toEqual({
      ok: true,
      output: {
        temperature: 25.0
      }
    })
  })

  it('returns error for unknown location', async () => {
    const result = await getWeatherTool.execute({ location: 'Berlin' }, { ctx })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'unknown_location',
        message: 'Unknown location'
      }
    })
  })

  it('returns error for invalid input', async () => {
    const result = await getWeatherTool.execute({ foo: 'bar' } as any, { ctx })
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'input_format_error',
        message: 'Invalid tool input format',
        details: {
          errors: [
            expect.objectContaining({
              keyword: 'required',
              instancePath: '',
              message: 'must have required properties location'
            })
          ]
        }
      }
    })
  })

  it('returns error for invalid output', async () => {
    const invalidOutputTool = createTool({
      name: 'get-invalid-weather',
      description: 'Get invalid weather tool',
      inputSchema: GetWeatherInputSchema,
      outputSchema: GetWeatherOutputSchema,
      execute: async () => toolOk({ temperature: 'hot' } as any)
    })

    const result = await invalidOutputTool.execute({ location: 'London' }, { ctx })
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'output_format_error',
        message: 'Invalid tool output format',
        details: {
          errors: [
            expect.objectContaining({
              keyword: 'type',
              instancePath: '/temperature',
              message: 'must be number'
            })
          ]
        }
      }
    })
  })
})

describe('toolOk', () => {
  it('returns successful tool result with output', () => {
    expect(toolOk({ temperature: 25.0 })).toEqual({
      ok: true,
      output: {
        temperature: 25.0
      }
    })
  })
})

describe('toolFail', () => {
  it('returns failed tool result with default error code', () => {
    expect(toolFail('Something went wrong')).toEqual({
      ok: false,
      error: {
        code: 'tool_error',
        message: 'Something went wrong'
      }
    })
  })

  it('returns failed tool result with custom error code', () => {
    expect(toolFail('Unknown location', 'unknown_location')).toEqual({
      ok: false,
      error: {
        code: 'unknown_location',
        message: 'Unknown location'
      }
    })
  })

  it('returns failed tool result with optional error fields', () => {
    expect(toolFail('Rate limit exceeded', 'rate_limit', { details: { retryAfterMs: 1000 }, retryable: true })).toEqual({
      ok: false,
      error: {
        code: 'rate_limit',
        message: 'Rate limit exceeded',
        details: {
          retryAfterMs: 1000
        },
        retryable: true
      }
    })
  })
})

describe('renderToolResult', () => {
  it('returns string output as-is', () => {
    expect(renderToolResult(toolOk('text'))).toBe('text')
  })

  it('returns object output as pretty JSON', () => {
    expect(renderToolResult(toolOk({ value: 'x' }))).toBe(JSON.stringify({ value: 'x' }, null, 2))
  })

  it('returns failed output as pretty JSON error', () => {
    expect(renderToolResult(toolFail('Unknown tool', 'unknown_tool'))).toBe(
      JSON.stringify(
        {
          error: {
            code: 'unknown_tool',
            message: 'Unknown tool'
          }
        },
        null,
        2
      )
    )
  })
})
