//
// Copyright © 2024 Hardcore Engineering Inc.
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

import { ArrOf, type Builder, Hidden, Mixin, Prop, TypeNumber, TypeString } from '@hcengineering/model'
import core from '@hcengineering/model-core'
import chunter from '@hcengineering/chunter'
import { TChatMessage } from '@hcengineering/model-chunter'
import { type AIBotThread, type AIBotMessage } from '@hcengineering/ai-bot'

import aiBot from './plugin'

export { aiBotId } from '@hcengineering/ai-bot'
export { aiBotOperation } from './migration'
export default aiBot

@Mixin(aiBot.mixin.AIBotThread, chunter.class.ChatMessage)
export class TAIBotThread extends TChatMessage implements AIBotThread {}

@Mixin(aiBot.mixin.AIBotMessage, chunter.class.ChatMessage)
export class TAIBotMessage extends TChatMessage implements AIBotMessage {
  @Prop(ArrOf(TypeString()), core.string.String)
  @Hidden()
    tools!: string[]

  @Prop(TypeString(), core.string.String)
  @Hidden()
    modelName!: string

  @Prop(TypeString(), core.string.String)
  @Hidden()
    providerKind!: string

  @Prop(TypeNumber(), core.string.String)
  @Hidden()
    inputTokens!: number

  @Prop(TypeNumber(), core.string.String)
  @Hidden()
    outputTokens!: number
}

export function createModel (builder: Builder): void {
  builder.createModel(TAIBotThread, TAIBotMessage)
}
