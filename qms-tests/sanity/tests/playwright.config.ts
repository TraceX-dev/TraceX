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

import { devices, PlaywrightTestConfig } from '@playwright/test'
import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

let maxFailures: number | undefined
if (process.env.TESTS_MAX_FAILURES !== undefined) {
  maxFailures = parseInt(process.env.TESTS_MAX_FAILURES)
}

// Match the platform tests: Clipboard APIs require a secure context on local HTTP origins.
const localOrigins = [process.env.PLATFORM_URI]
  .filter((url): url is string => url !== undefined && url.startsWith('http://tracex.local:'))
  .map((url) => new URL(url).origin)

const config: PlaywrightTestConfig = {
  use: {
    channel: 'chromium',
    launchOptions: {
      args: localOrigins.length > 0 ? [`--unsafely-treat-insecure-origin-as-secure=${localOrigins.join(',')}`] : []
    }
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'QMS',
      use: {
        permissions: ['clipboard-read', 'clipboard-write'],
        ...devices['Desktop Chrome'],
        screenshot: 'only-on-failure',
        viewport: {
          width: 1440,
          height: 900
        },
        trace: {
          mode: 'retain-on-failure',
          snapshots: true,
          screenshots: true,
          sources: true
        }
      },
      dependencies: ['setup']
    }
  ],
  fullyParallel: false,
  workers: 1,
  retries: 2,
  timeout: 60000,
  maxFailures,
  reporter: [
    ['list'],
    ['html'],
    [
      'allure-playwright',
      {
        detail: false,
        suiteTitle: false
      }
    ]
  ]
}
export default config
