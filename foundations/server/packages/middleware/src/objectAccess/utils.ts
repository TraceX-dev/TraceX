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

import { type AccountUuid, type Doc, TxProcessor } from '@hcengineering/core'
import type { AccessReaders } from './state'

export function chunks<T> (items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

/**
 * `undefined` (everybody) absorbs any set.
 */
export function unionReaders (a: AccessReaders, b: AccessReaders): Set<AccountUuid> | undefined {
  if (a === undefined || b === undefined) return undefined
  return new Set([...a, ...b])
}

/**
 * Picks only the operations that touch `field`, so they can be replayed on a small object.
 */
export function pickFieldOperations (ops: Record<string, any>, field: string): Record<string, any> {
  const result: Record<string, any> = {}
  for (const key of Object.keys(ops)) {
    if (key === field) {
      result[key] = ops[key]
    } else if (key.startsWith('$') && typeof ops[key] === 'object' && ops[key] !== null && field in ops[key]) {
      result[key] = { [field]: ops[key][field] }
    }
  }
  return result
}

/**
 * Applies update operations of an AccountUuid[] attribute to its current value.
 */
export function applyArrayUpdate (
  current: Iterable<AccountUuid>,
  ops: Record<string, any>,
  field: string
): AccountUuid[] {
  const target: Record<string, any> = { [field]: Array.from(current) }
  TxProcessor.applyUpdate(target as unknown as Doc, pickFieldOperations(ops, field))
  const value = target[field]
  return Array.isArray(value) ? value.filter((it): it is AccountUuid => typeof it === 'string') : []
}

export function symmetricDifference<T> (a: Iterable<T>, b: Iterable<T>): Set<T> {
  const left = new Set(a)
  const right = new Set(b)
  const result = new Set<T>()
  for (const it of left) if (!right.has(it)) result.add(it)
  for (const it of right) if (!left.has(it)) result.add(it)
  return result
}
