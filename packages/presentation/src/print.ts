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

import { writable } from 'svelte/store'

/** Whether the current document is rendered by the isolated print application. @public */
export const printSessionStore = writable(false)

/** Number of print resources that have not reached content or a visible placeholder. @public */
export const pendingPrintResources = writable(0)

const resources = new Set<symbol>()

/** Register a resource before starting asynchronous print preparation. @public */
export function registerPrintResource (): () => void {
  const resource = Symbol('print-resource')
  resources.add(resource)
  pendingPrintResources.set(resources.size)
  return () => {
    resources.delete(resource)
    pendingPrintResources.set(resources.size)
  }
}
