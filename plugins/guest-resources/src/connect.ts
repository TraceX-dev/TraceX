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
import { Analytics } from '@hcengineering/analytics'
import platform, { getResource, PlatformError } from '@hcengineering/platform'
import { getCurrentLocation } from '@hcengineering/ui'
import {
  connectEmbeddedWorkspace,
  embeddedConnectionError,
  embeddedVersionError
} from '@hcengineering/workbench-resources'
import type { Client } from '@hcengineering/core'
import { get, writable } from 'svelte/store'

export const invalidError = writable(false)
export { embeddedConnectionError as connectionError, embeddedVersionError as versionError }

/** Resolve public-link authentication before opening the shared lightweight workspace. */
export async function connect (title: string): Promise<Client | undefined> {
  invalidError.set(false)
  embeddedConnectionError.set(false)
  embeddedVersionError.set(undefined)
  const loc = getCurrentLocation()
  const token = loc.query?.token
  const workspace = loc.path[1]
  const entryPoint = loc.path[0]
  if (workspace === undefined || token == null) {
    invalidError.set(true)
    return undefined
  }
  let connectAttempt = 0
  let exchangedToken: string | undefined
  while (true) {
    const current = getCurrentLocation()
    if (current.path[0] !== entryPoint || current.path[1] !== workspace || current.query?.token !== token) {
      return undefined
    }
    try {
      const exchange = await getResource(login.function.ExchangeGuestToken)
      exchangedToken ??= await exchange(token)
      return await connectEmbeddedWorkspace(title, workspace, exchangedToken)
    } catch (error) {
      Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
      if (
        error instanceof PlatformError &&
        (error.status.code === platform.status.Unauthorized || error.status.code === platform.status.Forbidden)
      ) {
        invalidError.set(true)
        return undefined
      }
      if (get(embeddedVersionError) !== undefined) return undefined
      embeddedConnectionError.set(true)
      const delay = Math.min(1000 * 2 ** Math.min(connectAttempt++, 4), 10000)
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
    }
  }
}
