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
import { parseIdentifier, requestIdentifierAllocation, requestNumberAllocation } from '../identifier'

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
})
