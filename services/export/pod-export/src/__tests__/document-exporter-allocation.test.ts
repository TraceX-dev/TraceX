/* eslint-disable @typescript-eslint/unbound-method */
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

import core, {
  type Class,
  type CustomSequence,
  type Doc,
  type Hierarchy,
  type LowLevelStorage,
  type MeasureContext,
  type Ref,
  type Space,
  type TxOperations
} from '@hcengineering/core'

import { DocumentExporter } from '../workspace/document-exporter'
import { type AttachmentExporter } from '../workspace/attachment-exporter'
import { type DataMapper } from '../workspace/data-mapper'
import { type ExportState } from '../workspace/types'
import { type RelationExporter } from '../workspace/relation-exporter'
import { type SpaceExporter } from '../workspace/space-exporter'

const docClass = 'test:class:ControlledDocument' as Ref<Class<Doc>>
const templateId = 'test:template:Product'

interface TestDocument {
  seqNumber: number
  code: string
  template?: string
}

/** Target client with just enough behaviour to run sequence allocation and guarded creation. */
class TargetClientStub {
  readonly created: Array<Record<string, any>> = []
  readonly notMatches: Array<{ _class: string, query: Record<string, any> }> = []
  private readonly sequences = new Map<string, CustomSequence>()

  constructor (
    private readonly stored: TestDocument[] = [],
    /** Commit results per attempt; missing entries succeed. */
    private readonly commitResults: boolean[] = []
  ) {}

  getHierarchy (): Hierarchy {
    return { isDerived: () => false } as unknown as Hierarchy
  }

  async findOne (_class: string, query: Record<string, any>): Promise<unknown> {
    if (_class === core.class.CustomSequence) {
      if (typeof query._id === 'string') return this.sequences.get(query._id)
      return this.sequences.get(`${query.namespace}|${query.scope}|${query.prefix}`)
    }
    return this.stored.find(
      (doc) =>
        (query.seqNumber === undefined || doc.seqNumber === query.seqNumber) &&
        (query.code === undefined || doc.code === query.code) &&
        (query.template === undefined || query.template.$exists === false || doc.template === query.template)
    )
  }

  apply (): {
    notMatch: (_class: string, query: Record<string, any>) => void
    createDoc: (_class: string, _space: string, data: Record<string, any>, id?: Ref<Doc>) => Promise<void>
    addCollection: (...args: any[]) => Promise<void>
    commit: () => Promise<{ result: boolean }>
  } {
    let sequence: CustomSequence | undefined
    let document: Record<string, any> | undefined
    return {
      notMatch: (_class, query) => {
        this.notMatches.push({ _class, query })
      },
      createDoc: async (_class, _space, data) => {
        if (_class === core.class.CustomSequence) {
          const stored = data as unknown as CustomSequence
          sequence = {
            ...stored,
            _id: `${stored.namespace ?? ''}|${stored.scope ?? ''}|${stored.prefix}` as Ref<CustomSequence>
          }
        } else {
          document = { ...data }
        }
      },
      addCollection: async () => {},
      commit: async () => {
        if (sequence !== undefined) {
          this.sequences.set(sequence._id, sequence)
          return { result: true }
        }
        const result = this.commitResults.shift() ?? true
        if (result && document !== undefined) {
          this.created.push(document)
        }
        return { result }
      }
    }
  }

  async createDoc (_class: string, _space: Ref<Space>, data: Record<string, any>): Promise<Ref<Doc>> {
    this.created.push({ ...data })
    return 'test:doc:created' as Ref<Doc>
  }

  async addCollection (): Promise<Ref<Doc>> {
    return 'test:doc:attached' as Ref<Doc>
  }

  async update (sequence: CustomSequence, operations: { $inc: { sequence: number } }): Promise<unknown> {
    const stored = this.sequences.get(sequence._id) ?? sequence
    stored.sequence += operations.$inc.sequence
    return { object: { ...stored } }
  }
}

function makeExporter (
  target: TargetClientStub,
  data: Record<string, any>
): { exporter: DocumentExporter, context: MeasureContext } {
  const context = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as unknown as MeasureContext
  const state: ExportState = {
    idMapping: new Map(),
    spaceMapping: new Map(),
    processingDocs: new Set(),
    uniqueFieldValues: new Map()
  }
  const dataMapper = {
    prepareDocumentData: jest.fn(async () => data),
    shouldAllocateIdentifier: jest.fn(() => true)
  } as unknown as DataMapper
  const spaceExporter = {
    getOrCreateTargetSpace: jest.fn(async () => 'test:target:space' as Ref<Space>)
  } as unknown as SpaceExporter
  const attachmentExporter = {
    exportAttachments: jest.fn(),
    exportCollaborativeContent: jest.fn()
  } as unknown as AttachmentExporter

  const exporter = new DocumentExporter(
    context,
    target as unknown as TxOperations,
    state,
    dataMapper,
    spaceExporter,
    attachmentExporter
  )
  exporter.setRelationExporter({
    exportForwardRelations: jest.fn(),
    exportInverseRelations: jest.fn(),
    exportAllRelations: jest.fn()
  } as unknown as RelationExporter)
  exporter.setCustomHandlers([])
  return { exporter, context }
}

async function exportOne (exporter: DocumentExporter): Promise<boolean> {
  const doc: Doc = {
    _id: 'test:doc:source' as Ref<Doc>,
    _class: docClass,
    space: 'test:source:space' as Ref<Space>,
    modifiedOn: 0,
    modifiedBy: 'test:account:user' as any
  }
  const sourceHierarchy = {
    isDerived: jest.fn(() => false),
    findDomain: jest.fn(() => 'domain:test'),
    getAllAttributes: jest.fn(() => new Map())
  } as unknown as Hierarchy
  const sourceLowLevel = { rawFindAll: jest.fn(async () => []) } as unknown as LowLevelStorage

  return await exporter.exportDocument(doc, 'duplicate', true, sourceHierarchy, sourceLowLevel, new Map(), [])
}

describe('DocumentExporter identifier allocation', () => {
  it('keeps the exported number when it is free in the target', async () => {
    const target = new TargetClientStub()
    const { exporter } = makeExporter(target, { code: 'QMS-5', seqNumber: 5, prefix: 'QMS', template: templateId })

    await expect(exportOne(exporter)).resolves.toBe(true)
    expect(target.created).toHaveLength(1)
    expect(target.created[0]).toMatchObject({ code: 'QMS-5', seqNumber: 5 })
    expect(target.notMatches.filter(({ _class }) => _class === docClass)).toEqual([
      { _class: docClass, query: { template: templateId, seqNumber: 5 } },
      { _class: docClass, query: { code: 'QMS-5' } }
    ])
  })

  it('renumbers the document when its number was taken between the check and the commit', async () => {
    const target = new TargetClientStub([{ seqNumber: 5, code: 'QMS-5', template: templateId }], [false])
    const { exporter } = makeExporter(target, { code: 'QMS-5', seqNumber: 5, prefix: 'QMS', template: templateId })

    await expect(exportOne(exporter)).resolves.toBe(true)
    expect(target.created).toHaveLength(1)
    expect(target.created[0]).toMatchObject({ code: 'QMS-6', seqNumber: 6 })
  })

  it('allocates the next code for an occupied code that does not follow the sequence', async () => {
    const target = new TargetClientStub([{ seqNumber: 42, code: 'LEGACY-3', template: templateId }])
    const { exporter } = makeExporter(target, { code: 'LEGACY-3', seqNumber: 5, prefix: 'QMS', template: templateId })

    await expect(exportOne(exporter)).resolves.toBe(true)
    expect(target.created).toHaveLength(1)
    expect(target.created[0]).toMatchObject({ code: 'LEGACY-4', seqNumber: 5 })
  })

  it('fails the export when the creation keeps failing without a conflict', async () => {
    const target = new TargetClientStub([], [false])
    const { exporter } = makeExporter(target, { code: 'QMS-5', seqNumber: 5, prefix: 'QMS', template: templateId })

    await expect(exportOne(exporter)).rejects.toThrow('creation failed without an identifier conflict')
    expect(target.created).toHaveLength(0)
  })
})
