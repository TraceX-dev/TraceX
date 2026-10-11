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
export interface ServerEnv {
  dbUrl: string
  fulltextUrl: string
  serverSecret: string
  frontUrl: string
  filesUrl: string | undefined
  mailUrl: string | undefined
  mailAuthToken: string | undefined
  webPushUrl: string | undefined
  accountsUrl: string
  serverPort: number
  enableCompression: boolean
  brandingPath: string | undefined
}

export function serverConfigFromEnv (): ServerEnv {
  const serverPort = parseInt(process.env.SERVER_PORT ?? '3333')
  const enableCompression = (process.env.ENABLE_COMPRESSION ?? 'false') === 'true'

  const dbUrl = process.env.DB_URL
  if (dbUrl === undefined) {
    console.error('please provide DB_URL')
    process.exit(1)
  }

  const fulltextUrl = process.env.FULLTEXT_URL
  if (fulltextUrl === undefined) {
    console.error('please provide Fulltext URL')
    process.exit(1)
  }

  const serverSecret = process.env.SERVER_SECRET
  if (serverSecret === undefined) {
    console.log('Please provide server secret')
    process.exit(1)
  }

  const frontUrl = process.env.FRONT_URL
  if (frontUrl === undefined) {
    console.log('Please provide FRONT_URL url')
    process.exit(1)
  }

  const filesUrl = process.env.FILES_URL
  const mailUrl = process.env.MAIL_URL
  const mailAuthToken = process.env.MAIL_AUTH_TOKEN
  const webPushUrl = process.env.WEB_PUSH_URL

  const accountsUrl = process.env.ACCOUNTS_URL
  if (accountsUrl === undefined) {
    console.log('Please provide ACCOUNTS_URL url')
    process.exit(1)
  }

  const brandingPath = process.env.BRANDING_PATH

  return {
    dbUrl,
    fulltextUrl,
    serverSecret,
    frontUrl,
    filesUrl,
    mailUrl,
    mailAuthToken,
    webPushUrl,
    accountsUrl,
    serverPort,
    enableCompression,
    brandingPath
  }
}
