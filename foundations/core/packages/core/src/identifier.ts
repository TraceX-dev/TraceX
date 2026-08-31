//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import core from './component'
import { type CustomSequence, type Identifier } from './classes'
import { type TxOperations } from './operations'
import { generateId } from './utils'

export interface IdentifierAllocationRequest {
  namespace: string
  scope?: string
  prefix: string
  minimum?: number
  /** Prefer this exact number before allocating the next available number. */
  requested?: number
}

export interface IdentifierAllocation {
  code: string
  sequence: number
}

export interface ParsedIdentifier {
  prefix: string
  sequence: number
}

/** Parses identifiers with a non-empty prefix and a positive numeric suffix. */
export function parseIdentifier (code: string): ParsedIdentifier | null {
  const match = code.match(/^(?<prefix>.+)-(?<sequence>\d+)$/)
  const prefix = match?.groups?.prefix
  const sequence = match?.groups?.sequence
  if (prefix === undefined || prefix.trim() === '' || sequence === undefined) return null

  const parsedSequence = Number(sequence)
  if (!Number.isSafeInteger(parsedSequence) || parsedSequence < 1) return null
  return { prefix, sequence: parsedSequence }
}

export async function allocateIdentifier (
  client: TxOperations,
  request: IdentifierAllocationRequest
): Promise<IdentifierAllocation> {
  if (request.namespace === '' || request.prefix === '') {
    throw new Error('Identifier namespace and prefix are required')
  }

  const scope = request.scope ?? ''
  const minimum = request.minimum ?? 1
  const requested = request.requested
  if (
    !Number.isSafeInteger(minimum) ||
    minimum < 1 ||
    (requested !== undefined && (!Number.isSafeInteger(requested) || requested < 1))
  ) {
    throw new Error('Identifier minimum must be a positive integer')
  }

  const query = { namespace: request.namespace, scope, prefix: request.prefix }
  let preferred = requested
  for (;;) {
    let sequence = await client.findOne(core.class.CustomSequence, query)
    if (sequence === undefined) {
      const sequenceId = generateId<CustomSequence>()
      const operations = client.apply('create-identifier-sequence')
      operations.notMatch(core.class.CustomSequence, query)
      await operations.createDoc(
        core.class.CustomSequence,
        core.space.Workspace,
        {
          attachedTo: core.class.CustomSequence,
          namespace: request.namespace,
          scope,
          prefix: request.prefix,
          sequence: 0
        },
        sequenceId
      )
      if (!(await operations.commit()).result) continue
      sequence = await client.findOne(core.class.CustomSequence, { _id: sequenceId })
      if (sequence === undefined) continue
    }

    const next = preferred ?? Math.max(sequence.sequence + 1, minimum)
    const code = `${request.prefix}-${next}`
    const operations = client.apply('allocate-identifier')
    operations.notMatch(core.class.Identifier, { namespace: request.namespace, scope, code })
    if (next > sequence.sequence) {
      operations.notMatch(core.class.CustomSequence, { _id: sequence._id, sequence: { $gte: next } })
      await operations.updateDoc(sequence._class, sequence.space, sequence._id, { sequence: next })
    }
    await operations.createDoc<Identifier>(core.class.Identifier, core.space.Workspace, {
      namespace: request.namespace,
      scope,
      code
    })
    if ((await operations.commit()).result) return { code, sequence: next }
    preferred = undefined
  }
}
