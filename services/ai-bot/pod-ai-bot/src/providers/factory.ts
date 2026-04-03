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

import config, { AIProviderConfig } from '../config'

import { type LLMProvider } from './types'
import { OpenAIProvider } from './openai'
import { AnthropicProvider } from './anthropic'

export function createProviders (): Map<string, LLMProvider> {
  const providers = new Map<string, LLMProvider>()
  for (const providerConfig of config.AIProviders) {
    providers.set(providerConfig.id, createProvider(providerConfig))
  }

  return providers
}

function createProvider (provider: AIProviderConfig): LLMProvider {
  const { kind, apiKey, baseUrl } = provider

  switch (kind) {
    case 'openai':
      return new OpenAIProvider(apiKey, baseUrl)
    case 'anthropic':
      return new AnthropicProvider(apiKey)
    default:
      throw new Error(`Unknown provider kind: ${kind}`)
  }
}
