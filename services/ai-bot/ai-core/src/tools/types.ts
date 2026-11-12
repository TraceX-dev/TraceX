//
// Copyright © 2026 TraceX.
// Copyright © 2026 TraceX SAS.
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

import { MeasureContext } from '@hcengineering/core'
import { type Static, type TObject, type TString, type TUnion } from 'typebox'

export type ToolInputSchema = TObject
export type ToolOutputSchema = TObject | TUnion | TString
export type ToolMetadata = Record<string, any>

export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
}

export interface ToolExecutorContext {
  ctx: MeasureContext
}

export interface ToolExecutorError {
  code: string
  message: string
  details?: unknown
  retryable?: boolean
}

export type ToolExecutorOutput<TOutputSchema> = TOutputSchema extends ToolOutputSchema ? Static<TOutputSchema> : string

export type ToolExecutorResult<TOutputSchema = unknown> =
  | {
      ok: true
      output: ToolExecutorOutput<TOutputSchema>
    }
  | {
      ok: false
      error: ToolExecutorError
    }

export type ToolExecutor<
  TInputSchema extends ToolInputSchema,
  TOutputSchema extends ToolOutputSchema,
  TContext extends ToolExecutorContext
> = (args: Static<TInputSchema>, context: TContext) => Promise<ToolExecutorResult<TOutputSchema>>

export interface ToolAction<
  TInputSchema extends ToolInputSchema,
  TOutputSchema extends ToolOutputSchema,
  TContext extends ToolExecutorContext,
  TMetadata extends ToolMetadata
> {
  // Tool identifier for LLM
  name: string
  // Human-readable display name
  title?: string
  // Tool description for LLM
  description: string
  // Tool input arguments schema
  inputSchema: TInputSchema
  // Tool successful output schema. Omit for string/text output.
  outputSchema?: TOutputSchema
  // Tool metadata
  metadata?: TMetadata
  // Tool annotations
  annotations?: ToolAnnotations
  // Tool executor
  execute: ToolExecutor<TInputSchema, TOutputSchema, TContext>
}

export interface Tool<
  TInputSchema extends ToolInputSchema,
  TOutputSchema extends ToolOutputSchema,
  TContext extends ToolExecutorContext,
  TMetadata extends ToolMetadata
> extends ToolAction<TInputSchema, TOutputSchema, TContext, TMetadata> {
  execute: ToolAction<TInputSchema, TOutputSchema, TContext, TMetadata>['execute']
}
