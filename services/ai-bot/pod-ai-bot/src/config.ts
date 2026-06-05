//
// Copyright © 2024-2026 Hardcore Engineering Inc.
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

import fs from 'fs'
import yaml from 'js-yaml'
import convict, { Schema } from 'convict'

export interface LlmToolConfig {
  name: string
  description: string
  systemPrompt?: string
}

export interface LlmModelConfig {
  id: string
  kind: 'openai' | 'anthropic'
  model: string
  apiKey: string
  baseUrl?: string
  tools?: LlmToolConfig[]
}

interface YamlConfig {
  accountsUrl: string
  collaboratorUrl: string
  dbUrl: string
  serverSecret: string
  serviceId: string
  port: number
  bot: {
    firstName: string
    lastName: string
    avatarPath: string
    avatarName: string
    avatarContentType: string
    password: string
  }
  openai: {
    apiKey: string
    baseUrl: string
    model: string
    translateModel: string
    summaryModel: string
  }
  limits: {
    maxContentTokens: number
    maxHistoryRecords: number
  }
  love: {
    endpoint: string
  }
  datalab: {
    apiKey: string
  }
  billing: {
    url: string
  }
  deepgram: {
    pollIntervalMinutes: number
    apiKey: string
    projectId: string
    tag: string
  }
  queue: {
    region: string
  }
  llm: LlmModelConfig[]
}

export interface Config {
  AccountsURL: string
  CollaboratorURL: string
  DbURL: string
  ServerSecret: string
  ServiceID: string
  BotFirstName: string
  BotLastName: string
  BotAvatarPath: string
  BotAvatarName: string
  BotAvatarContentType: string
  BotPassword: string
  OpenAIKey: string
  OpenAIModel: string
  OpenAITranslateModel: string
  OpenAISummaryModel: string
  OpenAIBaseUrl: string
  MaxContentTokens: number
  MaxHistoryRecords: number
  Port: number
  LoveEndpoint: string
  DataLabApiKey: string
  BillingUrl: string
  DeepgramPollIntervalMinutes: number
  DeepgramApiKey: string
  DeepgramProjectId: string
  DeepgramTag: string
  QueueRegion: string
  Llm: LlmModelConfig[]
}

const llmModelSchema: Schema<LlmModelConfig> = {
  id: {
    doc: 'LLM Model Id',
    format: 'required-string',
    default: null
  },
  kind: {
    doc: 'Provider kind',
    format: 'required-string',
    default: null
  },
  model: {
    doc: 'Provider model',
    format: 'required-string',
    default: null
  },
  apiKey: {
    doc: 'Provider API key',
    format: 'required-string',
    default: null
  },
  baseUrl: {
    doc: 'Provider base URL',
    format: 'required-string',
    default: null
  },
  tools: {
    doc: 'LLM-backed tool definitions',
    format: 'tools-array',
    default: undefined
  }
}

convict.addFormat({
  name: 'required-string',
  validate: (value: unknown): void => {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('must be a non-empty string')
    }
  }
})

convict.addFormat({
  name: 'tools-array',
  validate: (value: unknown): void => {
    if (value === undefined || value === null) return
    if (!Array.isArray(value)) {
      throw new Error('must be an array')
    }
    value.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        throw new Error(`tools[${index}] must be an object`)
      }
      if (typeof entry.name !== 'string' || entry.name.trim() === '') {
        throw new Error(`tools[${index}].name must be a non-empty string`)
      }
      if (typeof entry.description !== 'string' || entry.description.trim() === '') {
        throw new Error(`tools[${index}].description must be a non-empty string`)
      }
      if (entry.systemPrompt !== undefined && typeof entry.systemPrompt !== 'string') {
        throw new Error(`tools[${index}].systemPrompt must be a string`)
      }
    })
  }
})

convict.addFormat({
  name: 'providers-array',
  coerce: (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (value.trim() === '') return []
      return JSON.parse(value)
    }
    return value
  },
  validate: (value: unknown): void => {
    if (!Array.isArray(value)) {
      throw new Error('must be an array')
    }
    value.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        throw new Error(`providers[${index}] must be an object`)
      }
      validateProvider(entry, index)
    })
  }
})

const configSchema: Schema<YamlConfig> = {
  accountsUrl: {
    doc: 'Accounts service URL',
    format: 'required-string',
    default: null,
    env: 'ACCOUNTS_URL'
  },
  collaboratorUrl: {
    doc: 'Collaborator service URL',
    format: 'required-string',
    default: null,
    env: 'COLLABORATOR_URL'
  },
  dbUrl: {
    doc: 'Database URL',
    format: 'required-string',
    default: null,
    env: 'DB_URL'
  },
  serverSecret: {
    doc: 'Server secret',
    format: 'required-string',
    default: null,
    env: 'SERVER_SECRET'
  },
  serviceId: {
    doc: 'Service ID',
    format: String,
    default: 'ai-bot-service',
    env: 'SERVICE_ID'
  },
  port: {
    doc: 'Server port',
    format: 'nat',
    default: 4010,
    env: 'PORT'
  },
  bot: {
    firstName: {
      doc: 'AI Bot First Name',
      format: 'required-string',
      default: null
    },
    lastName: {
      doc: 'AI Bot Last Name',
      format: 'required-string',
      default: null
    },
    password: {
      doc: 'AI Bot Password',
      format: 'required-string',
      default: null
    },
    avatarPath: {
      doc: 'AI Bot Avatar Path',
      format: 'required-string',
      default: null
    },
    avatarName: {
      doc: 'AI Bot Avatar Name',
      format: 'required-string',
      default: null
    },
    avatarContentType: {
      doc: 'AI Bot Avatar Content Type',
      format: 'required-string',
      default: null
    }
  },
  openai: {
    apiKey: {
      doc: 'OpenAI API key',
      format: String,
      default: '',
      env: 'OPENAI_API_KEY'
    },
    baseUrl: {
      doc: 'OpenAI base URL',
      format: String,
      default: '',
      env: 'OPENAI_BASE_URL'
    },
    model: {
      doc: 'OpenAI chat model',
      format: String,
      default: 'gpt-4o-mini',
      env: 'OPENAI_MODEL'
    },
    translateModel: {
      doc: 'OpenAI translate model',
      format: String,
      default: 'gpt-4o-mini',
      env: 'OPENAI_TRANSLATE_MODEL'
    },
    summaryModel: {
      doc: 'OpenAI summary model',
      format: String,
      default: 'gpt-4o-mini',
      env: 'OPENAI_SUMMARY_MODEL'
    }
  },
  limits: {
    maxContentTokens: {
      doc: 'Maximum content tokens',
      format: 'nat',
      default: 12800,
      env: 'MAX_CONTENT_TOKENS'
    },
    maxHistoryRecords: {
      doc: 'Maximum history records',
      format: 'nat',
      default: 500,
      env: 'MAX_HISTORY_RECORDS'
    }
  },
  love: {
    endpoint: {
      doc: 'Love service endpoint',
      format: String,
      default: '',
      env: 'LOVE_ENDPOINT'
    }
  },
  datalab: {
    apiKey: {
      doc: 'DataLab API key',
      format: String,
      default: '',
      env: 'DATALAB_API_KEY'
    }
  },
  billing: {
    url: {
      doc: 'Billing service URL',
      format: String,
      default: '',
      env: 'BILLING_URL'
    }
  },
  deepgram: {
    pollIntervalMinutes: {
      doc: 'Deepgram poll interval minutes',
      format: 'nat',
      default: 60,
      env: 'DEEPGRAM_POLL_INTERVAL_MINUTES'
    },
    apiKey: {
      doc: 'Deepgram API key',
      format: String,
      default: '',
      env: 'DEEPGRAM_API_KEY'
    },
    projectId: {
      doc: 'Deepgram project ID',
      format: String,
      default: '',
      env: 'DEEPGRAM_PROJECT_ID'
    },
    tag: {
      doc: 'Deepgram tag',
      format: String,
      default: '',
      env: 'DEEPGRAM_TAG'
    }
  },
  queue: {
    region: {
      doc: 'Queue region',
      format: String,
      default: '',
      env: 'QUEUE_REGION'
    }
  },
  llm: {
    doc: 'AI providers configuration',
    format: 'providers-array',
    default: []
  }
}

function loadConfig (): Config {
  const yamlConfig = loadYamlConfig()

  const config = convict<YamlConfig>(configSchema)
  config.load(yamlConfig ?? {})
  config.validate({ allowed: 'strict' })

  const parsed = config.getProperties()

  return {
    AccountsURL: parsed.accountsUrl,
    CollaboratorURL: parsed.collaboratorUrl,
    DbURL: parsed.dbUrl,
    ServerSecret: parsed.serverSecret,
    ServiceID: parsed.serviceId,
    BotFirstName: parsed.bot.firstName,
    BotLastName: parsed.bot.lastName,
    BotPassword: parsed.bot.password,
    BotAvatarName: parsed.bot.avatarName,
    BotAvatarPath: parsed.bot.avatarPath,
    BotAvatarContentType: parsed.bot.avatarContentType,
    OpenAIKey: parsed.openai.apiKey,
    OpenAIModel: parsed.openai.model,
    OpenAITranslateModel: parsed.openai.translateModel,
    OpenAISummaryModel: parsed.openai.summaryModel,
    OpenAIBaseUrl: parsed.openai.baseUrl,
    MaxContentTokens: parsed.limits.maxContentTokens,
    MaxHistoryRecords: parsed.limits.maxHistoryRecords,
    Port: parsed.port,
    LoveEndpoint: parsed.love.endpoint,
    DataLabApiKey: parsed.datalab.apiKey,
    BillingUrl: parsed.billing.url,
    DeepgramPollIntervalMinutes: parsed.deepgram.pollIntervalMinutes,
    DeepgramApiKey: parsed.deepgram.apiKey,
    DeepgramProjectId: parsed.deepgram.projectId,
    DeepgramTag: parsed.deepgram.tag,
    QueueRegion: parsed.queue.region,
    Llm: parsed.llm
  }
}

function loadYamlConfig (): YamlConfig | undefined {
  const configYaml = process.env.CONFIG_YAML
  if (configYaml !== undefined) {
    try {
      const content = Buffer.from(configYaml, 'base64').toString('utf8')
      return yaml.load(content) as YamlConfig
    } catch (error) {
      console.warn('Failed to load YAML config from CONFIG_YAML environment variable:', error)
    }
  }

  const configPath = process.env.CONFIG_PATH
  if (configPath !== undefined && fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8')
      return yaml.load(content) as YamlConfig
    } catch (error) {
      console.warn(`Failed to load YAML config from ${configPath}:`, error)
    }
  }

  return undefined
}

function validateProvider (value: Record<string, unknown>, index: number): void {
  const providerConfig = convict<LlmModelConfig>(llmModelSchema)
  providerConfig.load(value)
  try {
    providerConfig.validate({ allowed: 'strict' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`providers[${index}] ${message}`)
  }
}

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const config: Config = loadConfig()

export default config
