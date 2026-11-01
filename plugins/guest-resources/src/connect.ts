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

import login from '@hcengineering/login'
import { getResource } from '@hcengineering/platform'
import { getCurrentLocation } from '@hcengineering/ui'
import {
  connectEmbeddedWorkspace,
  embeddedConnectionError,
  embeddedVersionError
} from '@hcengineering/workbench-resources'
import type { Client } from '@hcengineering/core'

export { embeddedConnectionError as invalidError, embeddedVersionError as versionError }

/** Resolve public-link authentication before opening the shared lightweight workspace. */
export async function connect (title: string): Promise<Client | undefined> {
  const loc = getCurrentLocation()
  const token = loc.query?.token
  const workspace = loc.path[1]
  if (workspace === undefined || token == null) {
    embeddedConnectionError.set(true)
    return undefined
  }
  try {
    const exchange = await getResource(login.function.ExchangeGuestToken)
    return await connectEmbeddedWorkspace(title, workspace, await exchange(token))
  } catch (error) {
    embeddedConnectionError.set(true)
    throw error
  }
}
