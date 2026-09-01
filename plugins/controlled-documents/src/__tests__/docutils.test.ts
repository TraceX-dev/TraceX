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

import core, { type CustomSequence, type Ref, type TxOperations } from '@hcengineering/core'
import { allocateDocumentIdentifier } from '../docutils'
import documents from '../plugin'

interface TestDocument {
  seqNumber: number
  code: string
  template?: string
}

function sequenceKey (namespace: string, scope: string, prefix: string): string {
  return `${namespace}|${scope}|${prefix}`
}

class DocutilsTestClient {
  private readonly sequences = new Map<string, CustomSequence>()

  constructor (private readonly stored: TestDocument[] = []) {}

  seed (namespace: string, scope: string, prefix: string, sequence: number): void {
    const key = sequenceKey(namespace, scope, prefix)
    const stored: CustomSequence = {
      _id: key as Ref<CustomSequence>,
      namespace,
      scope,
      prefix,
      sequence
    } as unknown as CustomSequence
    this.sequences.set(key, stored)
  }

  async findOne (_class: string, query: Record<string, any>): Promise<unknown> {
    if (_class === core.class.CustomSequence) {
      if (typeof query._id === 'string') return this.sequences.get(query._id)
      return this.sequences.get(sequenceKey(query.namespace, query.scope, query.prefix))
    }

    return this.stored.find(
      (doc) =>
        (query.seqNumber === undefined || doc.seqNumber === query.seqNumber) &&
        (query.code === undefined || doc.code === query.code) &&
        (query.template === undefined || query.template.$exists === false || doc.template === query.template)
    )
  }

  apply (): {
    notMatch: () => void
    createDoc: (_class: string, _space: string, data: CustomSequence, id: Ref<CustomSequence>) => Promise<void>
    commit: () => Promise<{ result: boolean }>
  } {
    let created: CustomSequence | undefined
    return {
      notMatch: () => {},
      createDoc: async (_class, _space, data) => {
        created = {
          ...data,
          _id: sequenceKey(data.namespace ?? '', data.scope ?? '', data.prefix) as Ref<CustomSequence>
        }
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

function createClient (stored: TestDocument[] = []): { client: TxOperations, test: DocutilsTestClient } {
  const test = new DocutilsTestClient(stored)
  return { client: test as unknown as TxOperations, test }
}

const template = 'documents:template:Test' as Ref<any>

describe('allocateDocumentIdentifier', () => {
  it('keeps the first values when the creation succeeds', async () => {
    const { client } = createClient()
    const attempt = jest.fn(async () => true)

    await expect(
      allocateDocumentIdentifier(
        client,
        { scope: template, conflictQuery: { template }, codePrefix: 'QMS' },
        { seqNumber: 3, code: 'QMS-3' },
        attempt
      )
    ).resolves.toEqual({ seqNumber: 3, success: true })
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(attempt).toHaveBeenCalledWith(3, 'QMS-3')
  })

  it('advances the sequence and the code when the number is taken', async () => {
    const { client, test } = createClient([{ seqNumber: 5, code: 'QMS-5', template }])
    test.seed(`${documents.class.Document.split(':')[0]}.sequence`, template, 'seqNumber', 5)
    const attempt = jest.fn(async (_seqNumber: number, code: string) => code !== 'QMS-5')

    await expect(
      allocateDocumentIdentifier(
        client,
        { scope: template, conflictQuery: { template }, codePrefix: 'QMS' },
        { seqNumber: 5, code: 'QMS-5' },
        attempt
      )
    ).resolves.toEqual({ seqNumber: 6, success: true })
    expect(attempt).toHaveBeenNthCalledWith(2, 6, 'QMS-6')
  })

  it('keeps the sequence and takes the next code when only the code is taken', async () => {
    const { client } = createClient([{ seqNumber: 3, code: 'CUSTOM-3', template: 'other' as Ref<any> }])
    const attempt = jest.fn(async (_seqNumber: number, code: string) => code !== 'CUSTOM-3')

    await expect(
      allocateDocumentIdentifier(
        client,
        { scope: template, conflictQuery: { template } },
        { seqNumber: 7, code: 'CUSTOM-3' },
        attempt
      )
    ).resolves.toEqual({ seqNumber: 7, success: true })
    expect(attempt).toHaveBeenNthCalledWith(2, 7, 'CUSTOM-4')
  })

  it('gives up at once when the creation failed without a conflict', async () => {
    const { client } = createClient()
    const attempt = jest.fn(async () => false)

    await expect(
      allocateDocumentIdentifier(
        client,
        { scope: template, conflictQuery: { template }, codePrefix: 'QMS' },
        { seqNumber: 3, code: 'QMS-3' },
        attempt
      )
    ).resolves.toMatchObject({ success: false, reason: 'creation failed without an identifier conflict' })
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('gives up at once when the allocation is aborted', async () => {
    const { client } = createClient([{ seqNumber: 3, code: 'QMS-3', template }])
    const attempt = jest.fn(async () => false)

    await expect(
      allocateDocumentIdentifier(
        client,
        { scope: template, conflictQuery: { template }, codePrefix: 'QMS' },
        { seqNumber: 3, code: 'QMS-3' },
        attempt,
        async () => true
      )
    ).resolves.toMatchObject({ success: false, reason: 'the allocation was aborted' })
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('stops after ten conflicting attempts', async () => {
    const taken = Array.from({ length: 20 }, (_value, index) => ({
      seqNumber: index + 1,
      code: `QMS-${index + 1}`,
      template
    }))
    const { client } = createClient(taken)
    const attempt = jest.fn(async () => false)

    const result = await allocateDocumentIdentifier(
      client,
      { scope: template, conflictQuery: { template }, codePrefix: 'QMS' },
      { seqNumber: 3, code: 'QMS-3' },
      attempt
    )

    expect(result).toMatchObject({ success: false, reason: 'no free identifier after 10 attempts' })
    expect(attempt).toHaveBeenCalledTimes(10)
  })
})
