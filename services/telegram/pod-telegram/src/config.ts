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
interface Config {
  Host: string | undefined
  Port: number

  TelegramApiID: number
  TelegramApiHash: string
  TelegramAuthTTL: number

  DbUrl: string

  AccountsURL: string
  ServiceID: string
  Secret: string
}

const envMap: { [key in keyof Config]: string } = {
  Host: 'HOST',
  Port: 'PORT',

  TelegramApiID: 'TELEGRAM_API_ID',
  TelegramApiHash: 'TELEGRAM_API_HASH',
  TelegramAuthTTL: 'TELEGRAM_AUTH_TTL',

  DbUrl: 'DB_URL',

  AccountsURL: 'ACCOUNTS_URL',
  ServiceID: 'SERVICE_ID',
  Secret: 'SECRET'
}

const defaults: Partial<Config> = {
  Host: undefined,
  Port: 8086,

  TelegramApiID: undefined,
  TelegramApiHash: undefined,
  TelegramAuthTTL: 600 * 1000,

  DbUrl: undefined,

  AccountsURL: undefined,
  ServiceID: 'telegram-service',

  Secret: undefined
}

const required: Array<keyof Config> = ['TelegramApiID', 'TelegramApiHash', 'DbUrl', 'AccountsURL', 'Secret']

const mergeConfigs = <T>(defaults: Partial<T>, params: Partial<T>): T => {
  const result = { ...defaults }
  for (const key in params) {
    if (params[key] !== undefined) {
      result[key] = params[key]
    }
  }
  return result as T
}

const parseNumber = (str: string | undefined): number | undefined => (str != null ? Number(str) : undefined)

const config = (() => {
  const ttl = parseNumber(process.env[envMap.TelegramAuthTTL])
  const params: Partial<Config> = {
    Host: process.env[envMap.Host],
    Port: parseNumber(process.env[envMap.Port]),
    TelegramApiID: parseNumber(process.env[envMap.TelegramApiID]),
    TelegramApiHash: process.env[envMap.TelegramApiHash],
    TelegramAuthTTL: ttl === undefined ? ttl : ttl * 1000,
    DbUrl: process.env[envMap.DbUrl],
    AccountsURL: process.env[envMap.AccountsURL],
    ServiceID: process.env[envMap.ServiceID],
    Secret: process.env[envMap.Secret]
  }

  const missingEnv = required.filter((key) => params[key] === undefined).map((key) => envMap[key])

  if (missingEnv.length > 0) {
    throw Error(`Missing env variables: ${missingEnv.join(', ')}`)
  }

  const res = mergeConfigs<Config>(defaults, params)
  return res
})()

export default config
