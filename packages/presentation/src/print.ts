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

import { getContext, setContext } from 'svelte'
import { writable, type Readable } from 'svelte/store'

const PRINT_CONTEXT = Symbol('print-context')

/** Rendering state owned by one isolated print application. @public */
export interface PrintContext {
  readonly pendingResources: Readable<number>
  readonly registerResource: () => () => void
  readonly documentReady: Readable<boolean>
  readonly error: Readable<Error | undefined>
  readonly markDocumentReady: () => void
  readonly fail: (error: unknown) => void
}

/** Initialize the print context during PrintApp component initialization. @public */
export function providePrintContext (): PrintContext {
  const pendingResources = writable(0)
  const resources = new Set<symbol>()
  const documentReady = writable(false)
  const error = writable<Error | undefined>(undefined)
  const context: PrintContext = {
    pendingResources,
    documentReady,
    error,
    markDocumentReady: () => {
      documentReady.set(true)
    },
    fail: (cause) => {
      error.set(cause instanceof Error ? cause : new Error(String(cause)))
    },
    registerResource: () => {
      const resource = Symbol('print-resource')
      resources.add(resource)
      pendingResources.set(resources.size)
      return () => {
        resources.delete(resource)
        pendingResources.set(resources.size)
      }
    }
  }
  return setContext(PRINT_CONTEXT, context)
}

/** Read the rendering context during child component initialization. @public */
export function getPrintContext (): PrintContext | undefined {
  return getContext(PRINT_CONTEXT)
}
