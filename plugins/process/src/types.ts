//
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

import { Class, Doc, type AnyAttribute, type Association, type Ref } from '@hcengineering/core'
import { ContextId, ProcessFunction } from '.'

export interface Context {
  functions: Ref<ProcessFunction>[]
  attributes: AnyAttribute[]
  nested: Record<string, NestedContext>
  relations: Record<string, RelatedContext>
  executionContext: Record<ContextId, ProcessExecutionContext>
  convertible?: Array<{
    func: Ref<ProcessFunction>
    context: Context
  }>
}

export interface NestedContext {
  attribute: AnyAttribute
  attributes: AnyAttribute[]
}

export interface RelatedContext {
  name: string
  association: Ref<Association>
  direction: 'A' | 'B'
  attributes: AnyAttribute[]
}

export interface ProcessExecutionContext {
  name: string
  context: ContextId
  value: SelectedExecutionContext
  attributes: AnyAttribute[]
}

export interface Func {
  func: Ref<ProcessFunction>
  props: Record<string, any>
}

interface BaseSelectedContext {
  type: 'attribute' | 'relation' | 'nested' | 'userRequest' | 'function' | 'context' | 'const'
  // attribute key
  key: string

  // reduce array function for source obj
  sourceFunction?: Func

  // process one by one
  functions?: Func[]

  fallbackValue?: any
}

export interface SelectedConst extends BaseSelectedContext {
  type: 'const'
  value: any
}

export interface SelectedAttribute extends BaseSelectedContext {
  type: 'attribute'
}

export interface SelectedRelation extends BaseSelectedContext {
  type: 'relation'
  name: string
  association: Ref<Association>
  direction: 'A' | 'B'
}

export interface SelectedNested extends BaseSelectedContext {
  type: 'nested'
  path: string // ref attribute key
}

export interface SelectedUserRequest extends BaseSelectedContext {
  type: 'userRequest'
  _class: Ref<Class<Doc>>
  id: ContextId
  selectionSpace?: string // Space reference or serialized process context
  multiple?: boolean
}

export interface SelectedExecutionContext extends BaseSelectedContext {
  type: 'context'
  id: ContextId
}

export interface SelectedContextFunc extends BaseSelectedContext {
  type: 'function'
  func: Ref<ProcessFunction>
  props: Record<string, any>
}

export type SelectedContext =
  | SelectedAttribute
  | SelectedRelation
  | SelectedNested
  | SelectedUserRequest
  | SelectedContextFunc
  | SelectedExecutionContext
  | SelectedConst
