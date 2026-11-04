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

import core, { TxFactory } from '@hcengineering/core'
import { calculateModelHashSync } from '@hcengineering/server-core'
import { ModelHistory } from '../model-history'

const factory = new TxFactory(core.account.System)
const systemTx = [factory.createTxCreateDoc(core.class.Doc, core.space.Model, {})]
const userTx = Array.from({ length: 4 }, () => factory.createTxCreateDoc(core.class.Doc, core.space.Model, {}))
const systemHash = calculateModelHashSync(systemTx)
const version = (count: number): string => systemHash + ':' + calculateModelHashSync(userTx.slice(0, count), systemHash)

it('selects full, user and delta responses for unknown, system and user versions', () => {
  const history = new ModelHistory(systemTx, userTx)
  expect(history.getResponse('unknown', userTx)).toEqual({
    kind: 'full',
    hash: version(4),
    systemTx,
    userTx
  })
  expect(history.getResponse(systemHash, userTx)).toEqual({
    kind: 'user',
    hash: version(4),
    userTx
  })
  expect(history.getResponse(systemHash + ':unknown', userTx)).toEqual({
    kind: 'user',
    hash: version(4),
    userTx
  })
  for (let count = 0; count <= userTx.length; count++) {
    expect(history.getResponse(version(count), userTx)).toEqual({
      kind: 'delta',
      hash: version(4),
      transactions: userTx.slice(count)
    })
  }
})

it('continues the same chain when transactions are appended incrementally', () => {
  const history = new ModelHistory(systemTx, userTx.slice(0, 1))
  history.append(userTx.slice(1, 3))
  history.append(userTx.slice(3))
  expect(history.lastHash).toBe(calculateModelHashSync(systemTx.concat(userTx)))
  expect(history.getResponse(version(1), userTx)).toEqual({
    kind: 'delta',
    hash: version(4),
    transactions: userTx.slice(1)
  })
})

it('retains old indexes throughout the complete chain', () => {
  const history = new ModelHistory(systemTx, userTx)
  const oldVersion = history.hash
  const added = Array.from({ length: 1100 }, () => factory.createTxCreateDoc(core.class.Doc, core.space.Model, {}))
  history.append(added)
  expect(history.getResponse(oldVersion, userTx.concat(added))).toEqual({
    kind: 'delta',
    hash: history.hash,
    transactions: added
  })
})

it('recognizes only a complete version with the same system as current', () => {
  const history = new ModelHistory(systemTx, userTx)
  expect(history.isCurrent(version(4))).toBe(true)
  expect(history.isCurrent(version(3))).toBe(false)
  expect(history.isCurrent(systemHash)).toBe(false)
  expect(history.isCurrent('other:' + history.lastHash)).toBe(false)
  expect(history.getResponse('other:' + history.lastHash, userTx).kind).toBe('full')
})

it('keeps response arrays separate from the supplied model', () => {
  const history = new ModelHistory(systemTx, userTx)
  const full = history.getResponse('', userTx)
  if (full.kind !== 'full') throw new Error('Expected a full response')
  expect(full.systemTx).not.toBe(systemTx)
  expect(full.userTx).not.toBe(userTx)
  const response = history.getResponse(systemHash, userTx)
  if (response.kind !== 'user') throw new Error('Expected a user response')
  expect(response.userTx).not.toBe(userTx)
})
