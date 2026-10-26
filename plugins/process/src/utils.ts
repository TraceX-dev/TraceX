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

import type { Tx, TxUpdateDoc } from '@hcengineering/core'
import { SelectedContext } from './types'
import core from '@hcengineering/core'
import { Card } from '@hcengineering/card'
import { parseDSLContext } from './dslContext'

export function parseContext (value: any): SelectedContext | undefined {
  if (value === undefined) return
  if (typeof value !== 'string') return
  const index = value.indexOf('${')
  if (index === -1) return
  const endIndex = value.lastIndexOf('}')
  if (endIndex === -1) return
  const content = value.substring(index + 1, endIndex + 1)
  try {
    const res = JSON.parse(content) as SelectedContext
    if (res.type === undefined) return
    return res
  } catch {
    return parseDSLContext(value)
  }
}

export function isUpdateTx (etx: Tx): etx is TxUpdateDoc<Card> {
  return etx._class === core.class.TxUpdateDoc
}
