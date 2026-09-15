//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
import Schema, { Validator } from 'typebox/schema'

import {
  type Tool,
  type ToolAction,
  type ToolExecutorContext,
  type ToolInputSchema,
  type ToolMetadata,
  type ToolOutputSchema,
  ToolExecutorError,
  ToolExecutorResult
} from './types'

class ToolImpl<
  TInputSchema extends ToolInputSchema,
  TOutputSchema extends ToolOutputSchema,
  TContext extends ToolExecutorContext,
  TMetadata extends ToolMetadata
> implements Tool<TInputSchema, TOutputSchema, TContext, TMetadata> {
  readonly name: string
  readonly description: string
  readonly inputSchema: TInputSchema
  readonly outputSchema?: TOutputSchema | undefined
  readonly metadata?: TMetadata

  readonly execute: ToolAction<TInputSchema, TOutputSchema, TContext, TMetadata>['execute']

  private readonly inputSchemaValidator: Validator<TInputSchema>
  private readonly outputSchemaValidator?: Validator<TOutputSchema> | undefined

  constructor (opts: ToolAction<TInputSchema, TOutputSchema, TContext, TMetadata>) {
    this.name = opts.name
    this.description = opts.description
    this.metadata = opts.metadata
    this.inputSchema = opts.inputSchema
    this.outputSchema = opts.outputSchema

    this.inputSchemaValidator = Schema.Compile(opts.inputSchema)
    this.outputSchemaValidator = opts.outputSchema !== undefined ? Schema.Compile(opts.outputSchema) : undefined

    this.execute = async (args, context) => {
      const valid = this.inputSchemaValidator.Check(args)
      if (!valid) {
        const { name: tool } = this
        const errors = getValidationErrors(this.inputSchemaValidator, args)

        context.ctx.warn('invalid tool input format', { tool, value: args, errors })
        return toolFail('Invalid tool input format', 'input_format_error', { details: { errors } })
      }

      try {
        const result = await opts.execute(args, context)

        if (result.ok) {
          if (this.outputSchemaValidator !== undefined) {
            const valid = this.outputSchemaValidator.Check(result.output)
            if (!valid) {
              const { name: tool } = this
              const errors = getValidationErrors(this.outputSchemaValidator, result.output)

              context.ctx.warn('invalid tool output format', { tool, value: result.output, errors })
              return toolFail('Invalid tool output format', 'output_format_error', { details: { errors } })
            }
          }
        }

        return result
      } catch (error: any) {
        return toolFail(error.message, error.code)
      }
    }
  }
}

function getValidationErrors<TSchema extends ToolInputSchema | ToolOutputSchema> (
  validator: Validator<TSchema>,
  value: unknown
): unknown[] {
  const [, errors] = validator.Errors(value)
  return errors
}

export function createTool<
  TInputSchema extends ToolInputSchema,
  TOutputSchema extends ToolOutputSchema,
  TContext extends ToolExecutorContext,
  TMetadata extends ToolMetadata
> (
  tool: ToolAction<TInputSchema, TOutputSchema, TContext, TMetadata>
): Tool<TInputSchema, TOutputSchema, TContext, TMetadata> {
  return new ToolImpl(tool)
}

export function toolOk<TOutput> (output: TOutput): { ok: true, output: TOutput } {
  return { ok: true, output }
}

export function toolFail (
  message: string,
  code: string = 'tool_error',
  options?: { details?: unknown, retryable?: boolean }
): { ok: false, error: ToolExecutorError } {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(options?.details !== undefined ? { details: options.details } : {}),
      ...(options?.retryable !== undefined ? { retryable: options.retryable } : {})
    }
  }
}

export function renderToolResult (result: ToolExecutorResult<any>): string {
  if (!result.ok) {
    return JSON.stringify({ error: result.error }, null, 2)
  }

  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)
}
