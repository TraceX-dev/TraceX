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

import type { Integration } from '@hcengineering/account-client'
import type { Resources } from '@hcengineering/platform'
import Configure from './components/Configure.svelte'
import GithubNextIcon from './components/GithubNextIcon.svelte'
import { disconnectGithubNextIntegration } from './utils'

export default async (): Promise<Resources> => ({
  component: {
    Connect: Configure,
    Configure,
    GithubNextIcon
  },
  handler: {
    DisconnectHandler: async (integration: Integration): Promise<void> => {
      await disconnectGithubNextIntegration(integration)
    }
  }
})
