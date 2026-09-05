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

import { type CustomSequence, type Ref, type TxOperations } from '..'
import {
  allocateWithRetries,
  parseIdentifier,
  requestIdentifierAllocation,
  requestNextIdentifier,
  requestNumberAllocation
} from '../identifier'

class SequenceTestClient {
  private sequence: CustomSequence | undefined

  constructor (private readonly rejectCreation: boolean = false) {}

  async findOne (_class: string, query: { _id?: string }): Promise<CustomSequence | undefined> {
    if (query._id !== undefined && query._id !== this.sequence?._id) return undefined
    return this.sequence
  }

  apply (): {
    notMatch: () => void
    createDoc: (_class: string, _space: string, data: CustomSequence, id: Ref<CustomSequence>) => Promise<void>
    commit: () => Promise<{ result: boolean }>
  } {
    let created: CustomSequence | undefined
    return {
      notMatch: () => {},
      createDoc: async (_class, _space, data, id) => {
        created = { ...data, _id: id }
      },
      commit: async () => {
        if (this.rejectCreation) return { result: false }
        if (this.sequence !== undefined || created === undefined) return { result: false }
        this.sequence = created
        return { result: true }
      }
    }
  }

  async update (
    sequence: CustomSequence,
    operations: { $inc: { sequence: number } }
  ): Promise<{ object: CustomSequence }> {
    sequence.sequence += operations.$inc.sequence
    return { object: { ...sequence } }
  }
}

function createClient (rejectCreation: boolean = false): TxOperations {
  return new SequenceTestClient(rejectCreation) as unknown as TxOperations
}

describe('identifier allocation', () => {
  it('atomically advances a numeric sequence', async () => {
    const client = createClient()

    await expect(
      requestNumberAllocation(client, { namespace: 'documents.sequence', sequence: 'seqNumber' })
    ).resolves.toBe(1)
    await expect(
      requestNumberAllocation(client, { namespace: 'documents.sequence', sequence: 'seqNumber' })
    ).resolves.toBe(2)
  })

  it('advances directly to the requested minimum', async () => {
    await expect(
      requestNumberAllocation(createClient(), {
        namespace: 'documents.sequence',
        sequence: 'seqNumber',
        minimum: 12
      })
    ).resolves.toBe(12)
  })

  it('formats identifiers from the allocated sequence', async () => {
    await expect(
      requestIdentifierAllocation(createClient(), {
        namespace: 'documents',
        prefix: 'TEST-TMP',
        minimum: 5
      })
    ).resolves.toBe('TEST-TMP-5')
  })

  it('returns distinct values for concurrent requests', async () => {
    const client = createClient()
    const values = await Promise.all(
      Array.from(
        { length: 8 },
        async () => await requestNumberAllocation(client, { namespace: 'documents.sequence', sequence: 'seqNumber' })
      )
    )

    expect(values.sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('rejects invalid allocation input', async () => {
    await expect(requestNumberAllocation(createClient(), { namespace: '', sequence: 'seqNumber' })).rejects.toThrow(
      'namespace and sequence are required'
    )
  })

  it('stops sequence initialization after ten conflicts', async () => {
    await expect(
      requestNumberAllocation(createClient(true), { namespace: 'documents.sequence', sequence: 'seqNumber' })
    ).rejects.toThrow('after 10 attempts')
  })

  it('parses prefixes containing hyphens', () => {
    expect(parseIdentifier('TEST-TMP-1')).toEqual({ prefix: 'TEST-TMP', sequence: 1 })
    expect(parseIdentifier('TEST-TMP')).toBeNull()
  })

  it('rejects prefixes that are not identifiers', () => {
    expect(parseIdentifier('My doc-1')).toBeNull()
    expect(parseIdentifier('a/b-1')).toBeNull()
    expect(parseIdentifier('-1')).toBeNull()
    expect(parseIdentifier('TEST-0')).toBeNull()
  })
})

/** Client holding a sequence per namespace, scope and prefix. */
class MultiSequenceTestClient {
  private readonly sequences = new Map<string, CustomSequence>()

  private key (namespace: string, scope: string, prefix: string): string {
    return `${namespace}|${scope}|${prefix}`
  }

  async findOne (_class: string, query: Record<string, any>): Promise<CustomSequence | undefined> {
    if (typeof query._id === 'string') return this.sequences.get(query._id)
    return this.sequences.get(this.key(query.namespace, query.scope, query.prefix))
  }

  apply (): {
    notMatch: () => void
    createDoc: (_class: string, _space: string, data: CustomSequence) => Promise<void>
    commit: () => Promise<{ result: boolean }>
  } {
    let created: CustomSequence | undefined
    return {
      notMatch: () => {},
      createDoc: async (_class, _space, data) => {
        const id = this.key(data.namespace ?? '', data.scope ?? '', data.prefix) as Ref<CustomSequence>
        created = { ...data, _id: id }
      },
      commit: async () => {
        if (created === undefined) return { result: false }
        this.sequences.set(created._id, created)
        return { result: true }
      }
    }
  }

  async update (sequence: CustomSequence, operations: { $inc: { sequence: number } }): Promise<unknown> {
    const stored = this.sequences.get(sequence._id) ?? sequence
    stored.sequence += operations.$inc.sequence
    return { object: { ...stored } }
  }
}

function multiClient (): TxOperations {
  return new MultiSequenceTestClient() as unknown as TxOperations
}

const noConflicts = async (): Promise<{ sequence: boolean, code: boolean }> => ({ sequence: false, code: false })

describe('allocateWithRetries', () => {
  const sequenceRequest = { namespace: 'documents.sequence', scope: 'template-1', sequence: 'seqNumber' }

  it('derives the code from the allocated number', async () => {
    const attempt = jest.fn(async () => true)

    await expect(
      allocateWithRetries(multiClient(), { ...sequenceRequest, minimum: 4, codePrefix: 'QMS' }, attempt, noConflicts)
    ).resolves.toEqual({ seqNumber: 4, code: 'QMS-4', success: true })
    expect(attempt).toHaveBeenCalledWith(4, 'QMS-4')
  })

  it('takes the next number and code when the number is taken', async () => {
    const attempt = jest.fn(async (_seqNumber: number, code: string) => code !== 'QMS-1')

    await expect(
      allocateWithRetries(multiClient(), { ...sequenceRequest, codePrefix: 'QMS' }, attempt, async () => ({
        sequence: true,
        code: false
      }))
    ).resolves.toMatchObject({ seqNumber: 2, code: 'QMS-2', success: true })
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('keeps the number and renumbers a custom code from its own sequence', async () => {
    const attempt = jest.fn(async (_seqNumber: number, code: string) => code !== 'LEGACY-3')

    await expect(
      allocateWithRetries(
        multiClient(),
        { ...sequenceRequest, minimum: 7, code: 'LEGACY-3', codeNamespace: 'documents' },
        attempt,
        async () => ({ sequence: false, code: true })
      )
    ).resolves.toMatchObject({ seqNumber: 7, code: 'LEGACY-4', success: true })
    expect(attempt).toHaveBeenNthCalledWith(2, 7, 'LEGACY-4')
  })

  it('keeps a code that is not an identifier as it is', async () => {
    const attempt = jest.fn(async () => true)

    await expect(
      allocateWithRetries(
        multiClient(),
        { ...sequenceRequest, code: 'a1b2', codeNamespace: 'documents' },
        attempt,
        noConflicts
      )
    ).resolves.toMatchObject({ seqNumber: 1, code: 'a1b2', success: true })
    expect(attempt).toHaveBeenCalledWith(1, 'a1b2')
  })

  it('gives up on a taken code that cannot be renumbered', async () => {
    const attempt = jest.fn(async () => false)

    await expect(
      allocateWithRetries(
        multiClient(),
        { ...sequenceRequest, code: 'a1b2', codeNamespace: 'documents' },
        attempt,
        async () => ({ sequence: false, code: true })
      )
    ).resolves.toMatchObject({ success: false, reason: 'the code a1b2 is already taken' })
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('reports a failure that no conflict explains', async () => {
    await expect(
      allocateWithRetries(multiClient(), { ...sequenceRequest, codePrefix: 'QMS' }, async () => false, noConflicts)
    ).resolves.toMatchObject({ success: false, reason: 'creation failed without an identifier conflict' })
  })

  it('reports an aborted allocation', async () => {
    await expect(
      allocateWithRetries(
        multiClient(),
        { ...sequenceRequest, codePrefix: 'QMS' },
        async () => false,
        async () => ({ sequence: true, code: false }),
        async () => true
      )
    ).resolves.toMatchObject({ success: false, reason: 'the allocation was aborted' })
  })

  it('stops after ten conflicting attempts', async () => {
    const attempt = jest.fn(async () => false)

    await expect(
      allocateWithRetries(multiClient(), { ...sequenceRequest, codePrefix: 'QMS' }, attempt, async () => ({
        sequence: true,
        code: false
      }))
    ).resolves.toMatchObject({ success: false, reason: 'no free identifier after 10 attempts' })
    expect(attempt).toHaveBeenCalledTimes(10)
  })

  it('rejects a request without exactly one code source', async () => {
    await expect(
      allocateWithRetries(multiClient(), { ...sequenceRequest }, async () => true, noConflicts)
    ).rejects.toThrow('either a code prefix or a code')
    await expect(
      allocateWithRetries(multiClient(), { ...sequenceRequest, code: 'LEGACY-3' }, async () => true, noConflicts)
    ).rejects.toThrow('a namespace to renumber a custom code from')
  })
})

describe('requestNextIdentifier', () => {
  it('allocates the first identifier after an occupied one', async () => {
    await expect(requestNextIdentifier(multiClient(), 'CC-8', 'documents')).resolves.toBe('CC-9')
  })

  it('rejects a value that is not an identifier', async () => {
    await expect(requestNextIdentifier(multiClient(), 'CC', 'documents')).rejects.toThrow('Invalid identifier: CC')
  })
})
