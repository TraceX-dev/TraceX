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

import type { WorkspaceUuid } from '@hcengineering/core'

interface WorkspaceClientEntry<T> {
  promise: Promise<T>
  value?: T
  expiresOn: number
  timer: NodeJS.Timeout
}

/** Bounded cache for stateless REST contexts; invalidation does not interrupt active callers. */
export class WorkspaceClientCache<T> {
  private readonly entries = new Map<string, WorkspaceClientEntry<T>>()

  constructor (
    private readonly maxEntries: number = 10,
    private readonly maxAgeMs: number = 300000
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      throw new RangeError('Workspace client cache limits must be positive')
    }
  }

  /** Share client creation, retaining the original expiry when an entry is reused. */
  async get (accountsUrl: string, workspace: WorkspaceUuid, create: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([accountsUrl, workspace])
    let entry = this.entries.get(key)
    if (entry !== undefined && entry.expiresOn <= Date.now()) {
      this.remove(key, entry)
      entry = undefined
    }

    if (entry === undefined) {
      while (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.entries().next().value
        if (oldest === undefined) break
        this.remove(oldest[0], oldest[1])
      }

      const created: WorkspaceClientEntry<T> = {
        promise: Promise.resolve().then(create),
        expiresOn: Date.now() + this.maxAgeMs,
        timer: setTimeout(() => {
          this.remove(key, created)
        }, this.maxAgeMs)
      }
      created.timer.unref()
      this.entries.set(key, created)
      entry = created
    } else {
      this.entries.delete(key)
      this.entries.set(key, entry)
    }

    try {
      entry.value = await entry.promise
      return entry.value
    } catch (err) {
      this.remove(key, entry)
      throw err
    }
  }

  /** Drop a workspace, optionally only if it still holds the caller's context. */
  invalidate (accountsUrl: string, workspace: WorkspaceUuid, value?: T): void {
    const key = JSON.stringify([accountsUrl, workspace])
    const entry = this.entries.get(key)
    if (entry !== undefined && (value === undefined || entry.value === value)) this.remove(key, entry)
  }

  /** Release cached references and expiry timers during service shutdown. */
  clear (): void {
    for (const [key, entry] of this.entries) this.remove(key, entry)
  }

  private remove (key: string, entry: WorkspaceClientEntry<T>): void {
    clearTimeout(entry.timer)
    if (this.entries.get(key) === entry) this.entries.delete(key)
  }
}
