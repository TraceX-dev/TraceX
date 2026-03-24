//
// Copyright © 2025 Hardcore Engineering Inc.
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

import { config as dotenv } from 'dotenv'

dotenv()

export interface Config {
  Port: number
  Secret: string
  ServiceID: string
  AccountsUrl: string
  DocumentClass: string
  DocumentSpace: string
  StorageProviderName: string
  SummaryAttribute: string
}

const config: Config = (() => {
  const params: Partial<Config> = {
    Port: parseInt(process.env.PORT ?? '4042'),
    Secret: process.env.SECRET,
    ServiceID: process.env.SERVICE_ID ?? 'qalico',
    AccountsUrl: process.env.ACCOUNTS_URL,
    DocumentClass: process.env.QALICO_DOCUMENT_CLASS ?? '69bd83caf66a7420cb3677d8',
    DocumentSpace: process.env.QALICO_DOCUMENT_SPACE,
    StorageProviderName: process.env.STORAGE_PROVIDER_NAME ?? 'minio',
    SummaryAttribute: process.env.QALICO_SUMMARY_ATTR ?? 'description'
  }

  const missingEnv = (Object.keys(params) as Array<keyof Config>).filter((key) => params[key] === undefined)

  if (missingEnv.length > 0) {
    throw Error(`Missing config for attributes: ${missingEnv.join(', ')}`)
  }

  return params as Config
})()

export default config
