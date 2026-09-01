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
import { type CustomSequence } from './classes'
import { type TxOperations } from './operations'
import { generateId } from './utils'

export interface NumberAllocationRequest {
  namespace: string
  scope?: string
  sequence: string
  minimum?: number
}

export interface IdentifierAllocationRequest {
  namespace: string
  scope?: string
  prefix: string
  minimum?: number
}

export interface ParsedIdentifier {
  prefix: string
  sequence: number
}

/**
 * Parses identifiers with a positive numeric suffix and a prefix of word characters,
 * which may itself contain hyphens: `TEST-TMP-1` is `TEST-TMP` and `1`.
 */
export function parseIdentifier (code: string): ParsedIdentifier | null {
  const match = code.match(/^(?<prefix>[\w-]+)-(?<sequence>\d+)$/)
  const prefix = match?.groups?.prefix
  const sequence = match?.groups?.sequence
  if (prefix === undefined || sequence === undefined) return null

  const parsedSequence = Number(sequence)
  if (!Number.isSafeInteger(parsedSequence) || parsedSequence < 1) return null
  return { prefix, sequence: parsedSequence }
}

const MAX_ALLOCATION_ATTEMPTS = 10

/**
 * Atomically increments a named sequence and returns its actual stored value.
 *
 * Every caller gets the result of its own increment, so returned values are always distinct.
 * Reaching `minimum` may take a second increment, which leaves a gap in the sequence
 * but never hands the same value to two callers.
 */
export async function requestNumberAllocation (client: TxOperations, request: NumberAllocationRequest): Promise<number> {
  if (request.namespace.trim() === '' || request.sequence.trim() === '') {
    throw new Error('Allocation namespace and sequence are required')
  }

  const minimum = request.minimum ?? 1
  if (!Number.isSafeInteger(minimum) || minimum < 1) {
    throw new Error('Allocation minimum must be a positive integer')
  }

  const scope = request.scope ?? ''
  const query = { namespace: request.namespace, scope, prefix: request.sequence }

  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt++) {
    let sequence = await client.findOne(core.class.CustomSequence, query)
    if (sequence === undefined) {
      const sequenceId = generateId<CustomSequence>()
      const operations = client.apply('create-custom-sequence')
      operations.notMatch(core.class.CustomSequence, query)
      await operations.createDoc<CustomSequence>(
        core.class.CustomSequence,
        core.space.Workspace,
        {
          attachedTo: core.class.CustomSequence,
          namespace: request.namespace,
          scope,
          prefix: request.sequence,
          sequence: 0
        },
        sequenceId
      )
      if (!(await operations.commit()).result) continue
      sequence = await client.findOne(core.class.CustomSequence, { _id: sequenceId })
      if (sequence === undefined) continue
    }

    const increment = await client.update(sequence, { $inc: { sequence: 1 } }, true)
    let value = (increment as { object: CustomSequence }).object.sequence
    if (value < minimum) {
      const advance = await client.update(sequence, { $inc: { sequence: minimum - value } }, true)
      value = (advance as { object: CustomSequence }).object.sequence
    }
    return value
  }

  throw new Error(`Unable to initialize sequence after ${MAX_ALLOCATION_ATTEMPTS} attempts`)
}

/** Allocates the next identifier from an atomically incremented prefix sequence. */
export async function requestIdentifierAllocation (
  client: TxOperations,
  request: IdentifierAllocationRequest
): Promise<string> {
  if (request.prefix.trim() === '') {
    throw new Error('Identifier prefix is required')
  }

  const sequence = await requestNumberAllocation(client, {
    namespace: request.namespace,
    scope: request.scope,
    sequence: request.prefix,
    minimum: request.minimum
  })
  return `${request.prefix}-${sequence}`
}
