//
// Copyright © 2026 Hardcore Engineering Inc.
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

import { AccountUuid } from '@hcengineering/core'
import {
  RunnableFunctionWithoutParse,
  RunnableFunctionWithParse,
  RunnableToolFunction
} from 'openai/lib/RunnableFunction'
import { WorkspaceClient } from '../workspace/workspaceClient'
import { ContextMode } from '../providers/types'

export type Tool<T extends object | string> = [PredefinedTool<T>, ToolFunc, ContextMode | 'any']

export type ChangeFields<T, R> = Omit<T, keyof R> & R
export type PredefinedTool<T extends object | string> = ChangeFields<
RunnableToolFunction<T>,
{
  function: PredefinedToolFunction<T>
}
>
export type PredefinedToolFunction<T extends object | string> = Omit<
T extends string ? RunnableFunctionWithoutParse : RunnableFunctionWithParse<any>,
'function'
>
export type ToolFunc = (workspaceClient: WorkspaceClient, user: AccountUuid | undefined, args: any) => Promise<string> | string
