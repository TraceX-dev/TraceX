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

import { allocateIdentifier, parseIdentifier } from '../identifier'
import type { CustomSequence, Identifier, Ref, TxOperations } from '..'

interface PendingOperation {
  creates: Array<{ _class: string, id: string, data: CustomSequence | Identifier }>
  update?: { id: string, sequence: number }
  notMatches: Array<{ _class: string, query: Record<string, unknown> }>
}

class IdentifierTestClient {
  private readonly sequences = new Map<string, CustomSequence>()
  private readonly identifiers = new Map<string, Identifier>()

  async findOne (_class: string, query: Record<string, unknown>): Promise<CustomSequence | undefined> {
    if (typeof query._id === 'string') {
      return Array.from(this.sequences.values()).find((sequence) => sequence._id === query._id)
    }

    return Array.from(this.sequences.values()).find(
      (sequence) =>
        sequence.namespace === query.namespace && sequence.scope === query.scope && sequence.prefix === query.prefix
    )
  }

  apply (): {
    notMatch: (_class: string, query: Record<string, unknown>) => void
    createDoc: (_class: string, space: string, data: CustomSequence, id: Ref<CustomSequence>) => Promise<void>
    updateDoc: (_class: string, space: string, id: string, data: { sequence: number }) => Promise<void>
    commit: () => Promise<{ result: boolean }>
  } {
    const pending: PendingOperation = { creates: [], notMatches: [] }
    return {
      notMatch: (_class, query) => {
        pending.notMatches.push({ _class, query })
      },
      createDoc: async (_class, _space, data, id) => {
        pending.creates.push({ _class, id, data })
      },
      updateDoc: async (_class, _space, id, data) => {
        pending.update = { id, sequence: data.sequence }
      },
      commit: async () => {
        if (pending.notMatches.some(({ _class, query }) => this.matchesAny(_class, query))) return { result: false }
        for (const create of pending.creates) {
          if ('sequence' in create.data) {
            const sequence: CustomSequence = { ...create.data, _id: create.id as Ref<CustomSequence> }
            this.sequences.set(create.id, sequence)
          } else {
            const identifier: Identifier = { ...create.data, _id: create.id as Ref<Identifier> }
            this.identifiers.set(create.id, identifier)
          }
        }
        if (pending.update !== undefined) {
          const sequence = this.sequences.get(pending.update.id)
          if (sequence === undefined || sequence.sequence >= pending.update.sequence) return { result: false }
          sequence.sequence = pending.update.sequence
          return { result: true }
        }
        return { result: pending.creates.length > 0 || pending.update !== undefined }
      }
    }
  }

  private matchesAny (_class: string, query: Record<string, unknown>): boolean {
    const values: Iterable<CustomSequence | Identifier> =
      'code' in query ? this.identifiers.values() : this.sequences.values()
    return Array.from(values).some((sequence) => {
      const record = sequence as unknown as Record<string, unknown>
      if (typeof query._id === 'string' && record._id !== query._id) return false
      if (typeof query.namespace === 'string' && record.namespace !== query.namespace) return false
      if (typeof query.scope === 'string' && record.scope !== query.scope) return false
      if (typeof query.prefix === 'string' && record.prefix !== query.prefix) return false
      const sequenceQuery = query.sequence as { $gte?: number } | undefined
      return (
        sequenceQuery?.$gte === undefined ||
        (typeof record.sequence === 'number' && record.sequence >= sequenceQuery.$gte)
      )
    })
  }
}

function client (): TxOperations {
  return new IdentifierTestClient() as unknown as TxOperations
}

describe('allocateIdentifier', () => {
  it('allocates identifiers sequentially within a namespace and prefix', async () => {
    const operations = client()

    await expect(allocateIdentifier(operations, { namespace: 'documents', prefix: 'TESTTMP' })).resolves.toEqual({
      code: 'TESTTMP-1',
      sequence: 1
    })
    await expect(allocateIdentifier(operations, { namespace: 'documents', prefix: 'TESTTMP' })).resolves.toEqual({
      code: 'TESTTMP-2',
      sequence: 2
    })
  })

  it('keeps sequences independent by namespace and scope', async () => {
    const operations = client()

    await allocateIdentifier(operations, { namespace: 'documents', scope: 'template-a', prefix: 'TESTTMP' })
    await allocateIdentifier(operations, { namespace: 'documents', scope: 'template-b', prefix: 'TESTTMP' })
    const result = await allocateIdentifier(operations, {
      namespace: 'training',
      scope: 'template-a',
      prefix: 'TESTTMP'
    })

    expect(result).toEqual({ code: 'TESTTMP-1', sequence: 1 })
  })

  it('reserves at least the requested number', async () => {
    await expect(
      allocateIdentifier(client(), { namespace: 'documents', prefix: 'TESTTMP', minimum: 12 })
    ).resolves.toEqual({
      code: 'TESTTMP-12',
      sequence: 12
    })
  })

  it('preserves a free requested number below the current sequence', async () => {
    const operations = client()
    await allocateIdentifier(operations, { namespace: 'documents', prefix: 'TESTTMP', minimum: 10 })

    await expect(
      allocateIdentifier(operations, { namespace: 'documents', prefix: 'TESTTMP', requested: 1 })
    ).resolves.toEqual({ code: 'TESTTMP-1', sequence: 1 })
  })

  it('parses prefixes containing hyphens', () => {
    expect(parseIdentifier('TEST-TMP-1')).toEqual({ prefix: 'TEST-TMP', sequence: 1 })
  })

  it('allocates distinct codes for concurrent requests', async () => {
    const operations = client()

    const allocations = await Promise.all(
      Array.from(
        { length: 8 },
        async () => await allocateIdentifier(operations, { namespace: 'documents', prefix: 'TESTTMP' })
      )
    )

    expect(new Set(allocations.map(({ code }) => code)).size).toBe(8)
    expect(allocations.map(({ sequence }) => sequence).sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8
    ])
  })
})
