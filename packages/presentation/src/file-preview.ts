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

import { writable, type Readable } from 'svelte/store'
import type { PrintContext } from './print'

/** Terminal state shared by registered file preview renderers. @public */
export type FilePreviewState = 'loading' | 'ready' | 'error'

/** One cancellable preview attempt, including type resolution and content rendering. @public */
export class FilePreviewSession {
  // Preserve request identity when dynamic component props are cloned.
  readonly [Symbol.toStringTag] = 'FilePreviewSession'
  readonly mode: 'interactive' | 'static'
  readonly signal: AbortSignal
  readonly state: Readable<FilePreviewState>
  private readonly controller = new AbortController()
  private readonly status = writable<FilePreviewState>('loading')
  private readonly finish: () => void
  private readonly timeout: ReturnType<typeof setTimeout> | undefined
  private settled = false

  constructor (print?: PrintContext) {
    this.mode = print === undefined ? 'interactive' : 'static'
    this.signal = this.controller.signal
    this.state = this.status
    this.finish = print?.registerResource() ?? (() => {})
    if (print !== undefined) {
      this.timeout = setTimeout(() => {
        this.fail(new Error('File preview timed out'))
      }, 15000)
    }
  }

  ready (): void {
    this.complete('ready')
  }

  fail (_error: unknown): void {
    if (this.settled) return
    this.controller.abort()
    this.complete('error')
  }

  destroy (): void {
    this.controller.abort()
    clearTimeout(this.timeout)
    this.finish()
    this.settled = true
  }

  private complete (state: FilePreviewState): void {
    if (this.settled) return
    this.settled = true
    clearTimeout(this.timeout)
    this.status.set(state)
    this.finish()
  }
}
