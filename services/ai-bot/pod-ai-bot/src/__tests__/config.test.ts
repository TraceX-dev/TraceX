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
//

import type { Config } from '../config'

const originalEnv = { ...process.env }

const yamlConfig = {
  bot: {
    firstName: 'TraceX',
    lastName: 'AI',
    avatarPath: './avatar.png',
    avatarName: 'avatar.png',
    avatarContentType: 'image/png'
  },
  llm: [
    {
      id: 'primary',
      kind: 'openai',
      model: 'test-model',
      apiKey: 'env:OPENROUTER_API_KEY',
      baseUrl: 'https://example.com'
    },
    {
      id: 'legacy',
      kind: 'openai',
      model: 'test-model',
      apiKey: 'legacy-key',
      baseUrl: 'https://example.com'
    }
  ]
}

function loadConfig (): Config {
  return require('../config').default as Config
}

beforeEach(() => {
  jest.resetModules()
  process.env = {
    ...originalEnv,
    CONFIG_YAML: Buffer.from(JSON.stringify(yamlConfig)).toString('base64'),
    ACCOUNTS_URL: 'http://account:3000',
    COLLABORATOR_URL: 'ws://collaborator:3078',
    DB_URL: 'postgres://user:pass@localhost/db',
    SERVER_SECRET: 'test-secret',
    AI_BOT_PASSWORD: 'test-bot-password',
    OPENAI_API_KEY: 'test-openai-key',
    OPENROUTER_API_KEY: 'test-provider-key'
  }
})

afterEach(() => {
  process.env = originalEnv
  jest.resetModules()
})

describe('ai-bot configuration secrets', () => {
  it('loads the bot password and provider key from environment variables', () => {
    const config = loadConfig()

    expect(config.BotPassword).toBe('test-bot-password')
    expect(config.OpenAIKey).toBe('test-openai-key')
    expect(config.Llm.map((provider) => provider.apiKey)).toEqual(['test-provider-key', 'legacy-key'])
  })

  it('keeps a legacy YAML config working without secret environment variables', () => {
    const legacyConfig = {
      ...yamlConfig,
      bot: { ...yamlConfig.bot, password: 'legacy-bot-password' },
      openai: { apiKey: 'legacy-openai-key' },
      llm: [yamlConfig.llm[1]]
    }
    process.env.CONFIG_YAML = Buffer.from(JSON.stringify(legacyConfig)).toString('base64')
    delete process.env.AI_BOT_PASSWORD
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENROUTER_API_KEY

    const config = loadConfig()

    expect(config.BotPassword).toBe('legacy-bot-password')
    expect(config.OpenAIKey).toBe('legacy-openai-key')
    expect(config.Llm[0].apiKey).toBe('legacy-key')
  })

  it('rejects an unset provider key', () => {
    delete process.env.OPENROUTER_API_KEY

    expect(loadConfig).toThrow('AI provider primary requires OPENROUTER_API_KEY')
  })

  it('rejects a missing bot password', () => {
    delete process.env.AI_BOT_PASSWORD

    expect(loadConfig).toThrow()
  })

  it('rejects an invalid provider environment reference', () => {
    const invalidConfig = {
      ...yamlConfig,
      llm: [{ ...yamlConfig.llm[0], apiKey: 'env:9INVALID' }]
    }
    process.env.CONFIG_YAML = Buffer.from(JSON.stringify(invalidConfig)).toString('base64')

    expect(loadConfig).toThrow('AI provider primary has an invalid apiKey environment reference')
  })
})
