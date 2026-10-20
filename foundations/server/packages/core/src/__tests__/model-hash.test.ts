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

import core, { TxFactory, type Ref, type Tx } from '@hcengineering/core'
import { createHash } from 'node:crypto'
import { calculateModelHashSync } from '../model-hash'

it('preserves the original SHA-1 chain for full and incremental model hashing', () => {
  const factory = new TxFactory(core.account.System)
  const transactions: Tx[] = [
    factory.createTxCreateDoc(core.class.Doc, core.space.Model, {}),
    factory.createTxCreateDoc(core.class.Doc, core.space.Model, {})
  ]
  transactions[1]._id = 'транзакция-😀' as Ref<Tx>
  const expected = transactions.reduce(
    (previous, tx) => createHash('sha1').update(previous).update(JSON.stringify(tx)).digest('hex'),
    ''
  )
  expect(calculateModelHashSync(transactions)).toBe(expected)
  const previous = calculateModelHashSync(transactions.slice(0, 1))
  expect(calculateModelHashSync(transactions.slice(1), previous)).toBe(expected)
  expect(calculateModelHashSync(transactions.slice().reverse())).not.toBe(expected)
})

it('preserves an empty or existing chain when no transactions are added', () => {
  expect(calculateModelHashSync([])).toBe('')
  expect(calculateModelHashSync([], 'previous')).toBe('previous')
})
