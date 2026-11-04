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

import { compareModelHashes, type LoadModelResponse, type Tx } from '@hcengineering/core'
import { calculateModelHashSync } from '@hcengineering/server-core'

/** Keep every user-model prefix hash without retaining the transaction cache. */
export class ModelHistory {
  private readonly indexes = new Map<string, number>()
  private userTxCount = 0
  lastHash: string

  constructor (
    private readonly systemTx: Tx[],
    userTx: Tx[],
    private readonly systemHash: string = calculateModelHashSync(systemTx)
  ) {
    this.lastHash = systemHash
    this.indexes.set(systemHash, 0)
    this.append(userTx)
  }

  get hash (): string {
    return this.systemHash + ':' + this.lastHash
  }

  append (transactions: readonly Tx[]): void {
    for (const tx of transactions) {
      this.lastHash = calculateModelHashSync([tx], this.lastHash)
      this.indexes.set(this.lastHash, ++this.userTxCount)
    }
  }

  isCurrent (hash: string): boolean {
    return compareModelHashes(hash, this.hash) === 'user'
  }

  getResponse (hash: string, userTx: readonly Tx[]): LoadModelResponse {
    const match = compareModelHashes(hash, this.hash)
    if (match === 'user') {
      return { kind: 'delta', hash: this.hash, transactions: [] }
    }
    if (match === 'system') {
      const separator = hash.indexOf(':')
      const index = separator === -1 ? undefined : this.indexes.get(hash.slice(separator + 1))
      return index === undefined
        ? { kind: 'user', hash: this.hash, userTx: userTx.slice() }
        : { kind: 'delta', hash: this.hash, transactions: userTx.slice(index) }
    }
    return { kind: 'full', hash: this.hash, systemTx: this.systemTx.slice(), userTx: userTx.slice() }
  }
}
