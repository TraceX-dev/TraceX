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

export interface AllocationRequest {
  /** Feature the sequence belongs to, e.g. `documents` or `documents.sequence`. */
  namespace: string
  /** What the numbering is counted per within the namespace, e.g. a template id. */
  scope?: string
  /** Lowest acceptable value, defaults to 1. */
  minimum?: number
}

export interface NumberAllocationRequest extends AllocationRequest {
  /** Name of the sequence within the namespace and scope. */
  sequence: string
}

export interface IdentifierAllocationRequest extends AllocationRequest {
  /** Identifier prefix, which also names the sequence the number comes from. */
  prefix: string
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

export interface AllocationConflicts {
  /** The allocated number is already taken. */
  sequence: boolean
  /** The code is already taken. */
  code: boolean
}

export interface RetriedAllocationRequest extends NumberAllocationRequest {
  /** Prefix the code is derived from, when the code follows the allocated number. */
  codePrefix?: string
  /**
   * Code to start from, when it does not follow the allocated number. A code that is not an
   * identifier is used as is, since there is no sequence to renumber it from on a conflict.
   */
  code?: string
  /** Namespace of the per-prefix sequence a custom code is renumbered from. */
  codeNamespace?: string
  /** Scope of the per-prefix sequence a custom code is renumbered from. */
  codeScope?: string
}

export interface AllocationOutcome {
  seqNumber: number
  code: string
  success: boolean
  /** Why the allocation was given up on, when it did not succeed. */
  reason?: string
}

/**
 * Allocates a number and a code, and retries the creation while either of them is taken
 * by a concurrent one. A failure with no conflicting document is not an allocation problem,
 * so it is reported instead of retried.
 *
 * `attempt` is expected to create the document in a single guarded transaction and to
 * return whether it applied, `findConflicts` to report which of the two values it lost to.
 */
export async function allocateWithRetries (
  client: TxOperations,
  request: RetriedAllocationRequest,
  attempt: (seqNumber: number, code: string) => Promise<boolean>,
  findConflicts: (seqNumber: number, code: string) => Promise<AllocationConflicts>,
  isAborted?: () => Promise<boolean>
): Promise<AllocationOutcome> {
  const { codePrefix, code: requestedCode, codeNamespace, codeScope, ...sequence } = request
  if ((codePrefix === undefined) === (requestedCode === undefined)) {
    throw new Error('Allocation requires either a code prefix or a code to start from')
  }
  if (codePrefix === undefined && codeNamespace === undefined) {
    throw new Error('Allocation requires a namespace to renumber a custom code from')
  }

  let seqNumber = await requestNumberAllocation(client, sequence)
  let code = codePrefix !== undefined ? `${codePrefix}-${seqNumber}` : (requestedCode as string)

  for (let attemptIndex = 0; attemptIndex < MAX_ALLOCATION_ATTEMPTS; attemptIndex++) {
    if (await attempt(seqNumber, code)) return { seqNumber, code, success: true }
    if (isAborted !== undefined && (await isAborted())) {
      return { seqNumber: -1, code, success: false, reason: 'the allocation was aborted' }
    }

    const conflicts = await findConflicts(seqNumber, code)
    if (!conflicts.sequence && !conflicts.code) {
      return { seqNumber: -1, code, success: false, reason: 'creation failed without an identifier conflict' }
    }

    if (conflicts.sequence || codePrefix !== undefined) {
      seqNumber = await requestNumberAllocation(client, { ...sequence, minimum: undefined })
    }
    if (codePrefix !== undefined) {
      code = `${codePrefix}-${seqNumber}`
    } else if (conflicts.code) {
      if (parseIdentifier(code) === null) {
        return { seqNumber: -1, code, success: false, reason: `the code ${code} is already taken` }
      }
      code = await requestNextIdentifier(client, code, codeNamespace as string, codeScope)
    }
  }

  return {
    seqNumber: -1,
    code,
    success: false,
    reason: `no free identifier after ${MAX_ALLOCATION_ATTEMPTS} attempts`
  }
}

/** Allocates the first identifier of the same prefix that comes after an occupied one. */
export async function requestNextIdentifier (
  client: TxOperations,
  occupiedCode: string,
  namespace: string,
  scope?: string
): Promise<string> {
  const parsedCode = parseIdentifier(occupiedCode)
  if (parsedCode === null) {
    throw new Error(`Invalid identifier: ${occupiedCode}`)
  }

  return await requestIdentifierAllocation(client, {
    namespace,
    scope,
    prefix: parsedCode.prefix,
    minimum: parsedCode.sequence + 1
  })
}
