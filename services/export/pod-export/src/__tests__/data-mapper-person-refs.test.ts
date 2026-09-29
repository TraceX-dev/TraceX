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

import contact from '@hcengineering/contact'
import core, {
  type AnyAttribute,
  type Class,
  type Doc,
  type Hierarchy,
  type MeasureContext,
  type Ref,
  type Space,
  type TxOperations
} from '@hcengineering/core'
import { DataMapper } from '../workspace/data-mapper'
import { type ExportState } from '../workspace/types'

const docClass = 'test:class:ControlledDocument' as Ref<Class<Doc>>
const otherDocClass = 'test:class:Other' as Ref<Class<Doc>>
const documentClass = 'test:class:Document' as Ref<Class<Doc>>
const targetSpace = 'test:space:target' as Ref<Space>

// Simplified class tree: Employee is a mixin of Person
const classExtends: Record<string, string | undefined> = {
  [contact.class.Person]: core.class.Doc,
  [contact.mixin.Employee]: contact.class.Person,
  [documentClass]: core.class.Doc
}

function arrOfRef (to: string): AnyAttribute['type'] {
  return {
    _class: core.class.ArrOf,
    of: { _class: core.class.RefTo, to }
  } as unknown as AnyAttribute['type']
}

function attr (name: string, type: AnyAttribute['type']): [string, AnyAttribute] {
  return [name, { name, type } as unknown as AnyAttribute]
}

const attributesByClass: Record<string, Map<string, AnyAttribute>> = {
  [docClass]: new Map([
    attr('title', { _class: core.class.TypeString } as any),
    attr('approvers', arrOfRef(contact.mixin.Employee)),
    attr('reviewers', arrOfRef(contact.mixin.Employee)),
    attr('coAuthors', arrOfRef(contact.mixin.Employee)),
    attr('externalApprovers', arrOfRef(contact.mixin.Employee)),
    attr('watchers', arrOfRef(contact.class.Person)),
    attr('relatedDocs', arrOfRef(documentClass))
  ]),
  [otherDocClass]: new Map([attr('title', { _class: core.class.TypeString } as any)])
}

function createHierarchy (): Hierarchy {
  const isDerived = (cls: string, base: string): boolean => {
    let current: string | undefined = cls
    while (current !== undefined) {
      if (current === base) return true
      current = classExtends[current]
    }
    return false
  }
  return {
    getAllAttributes: jest.fn((cls: string) => attributesByClass[cls] ?? new Map()),
    isDerived: jest.fn(isDerived)
  } as unknown as Hierarchy
}

/**
 * Target client which knows only the given persons.
 * Supports `{ _id: { $in: [...] } }` queries on contact.class.Person.
 */
function createTargetClient (existingPersons: string[]): TxOperations {
  const hierarchy = createHierarchy()
  const persons = new Set(existingPersons)
  return {
    getHierarchy: jest.fn(() => hierarchy),
    findAll: jest.fn(async (cls: string, query: any) => {
      if (cls !== contact.class.Person) return []
      const ids: string[] = query?._id?.$in ?? []
      return ids.filter((id) => persons.has(id)).map((_id) => ({ _id, _class: contact.class.Person }))
    })
  } as unknown as TxOperations
}

function createContext (): MeasureContext {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as MeasureContext
}

function createState (): ExportState {
  return {
    idMapping: new Map(),
    spaceMapping: new Map(),
    processingDocs: new Set(),
    uniqueFieldValues: new Map()
  }
}

function makeDoc (data: Record<string, any>, _class: Ref<Class<Doc>> = docClass): Doc {
  return {
    _id: `doc-${Math.random()}` as Ref<Doc>,
    _class,
    space: 'test:space:source' as Ref<Space>,
    modifiedOn: 0,
    modifiedBy: 'user' as any,
    ...data
  }
}

function personQueries (client: TxOperations): any[] {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return (client.findAll as jest.Mock).mock.calls.filter(([cls]) => cls === contact.class.Person)
}

describe('DataMapper - dropUnknownPersonRefs', () => {
  let context: MeasureContext

  beforeEach(() => {
    context = createContext()
  })

  it('drops refs to employees missing in the target workspace and keeps order of the rest', async () => {
    const client = createTargetClient(['p1', 'p2'])
    const mapper = new DataMapper(context, client, createState(), {}, undefined)

    const result = await mapper.prepareDocumentData(
      makeDoc({
        title: 'SOP',
        approvers: ['p2', 'ghost', 'p1'],
        reviewers: ['ghost'],
        coAuthors: ['p1'],
        externalApprovers: ['ghost-2']
      }),
      targetSpace,
      false
    )

    expect(result.approvers).toEqual(['p2', 'p1'])
    expect(result.reviewers).toEqual([])
    expect(result.coAuthors).toEqual(['p1'])
    expect(result.externalApprovers).toEqual([])
    expect(result.title).toBe('SOP')
  })

  it('handles arrays typed as Ref<Person> as well as Ref<Employee>', async () => {
    const client = createTargetClient(['p1'])
    const mapper = new DataMapper(context, client, createState(), {}, undefined)

    const result = await mapper.prepareDocumentData(makeDoc({ watchers: ['p1', 'ghost'] }), targetSpace, false)

    expect(result.watchers).toEqual(['p1'])
  })

  it('does not touch arrays of refs to non-person classes', async () => {
    const client = createTargetClient([])
    const mapper = new DataMapper(context, client, createState(), {}, undefined)

    const result = await mapper.prepareDocumentData(makeDoc({ relatedDocs: ['d1', 'd2'] }), targetSpace, false)

    expect(result.relatedDocs).toEqual(['d1', 'd2'])
    expect(personQueries(client)).toHaveLength(0)
  })

  it('keeps data untouched and does not warn when all persons exist', async () => {
    const client = createTargetClient(['p1', 'p2'])
    const mapper = new DataMapper(context, client, createState(), {}, undefined)

    const result = await mapper.prepareDocumentData(
      makeDoc({ approvers: ['p1', 'p2'], reviewers: ['p2'] }),
      targetSpace,
      false
    )

    expect(result.approvers).toEqual(['p1', 'p2'])
    expect(result.reviewers).toEqual(['p2'])
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(context.warn).not.toHaveBeenCalled()
  })

  it('logs a warning with the number of dropped refs', async () => {
    const client = createTargetClient(['p1'])
    const mapper = new DataMapper(context, client, createState(), {}, undefined)

    await mapper.prepareDocumentData(makeDoc({ approvers: ['p1', 'ghost', 'ghost-2'] }), targetSpace, false)

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(context.warn).toHaveBeenCalledWith(
      `Dropped 2 unknown person ref(s) from approvers of ${docClass} in target workspace`
    )
  })

  it('queries all person refs of a document at once', async () => {
    const client = createTargetClient(['p1', 'p2'])
    const mapper = new DataMapper(context, client, createState(), {}, undefined)

    await mapper.prepareDocumentData(
      makeDoc({ approvers: ['p1', 'ghost'], reviewers: ['p2', 'p1'], coAuthors: ['ghost'] }),
      targetSpace,
      false
    )

    const calls = personQueries(client)
    expect(calls).toHaveLength(1)
    expect(new Set(calls[0][1]._id.$in)).toEqual(new Set(['p1', 'p2', 'ghost']))
  })

  it('caches existence checks between documents of one export', async () => {
    const client = createTargetClient(['p1'])
    const mapper = new DataMapper(context, client, createState(), {}, undefined)

    const first = await mapper.prepareDocumentData(makeDoc({ approvers: ['p1', 'ghost'] }), targetSpace, false)
    const second = await mapper.prepareDocumentData(makeDoc({ approvers: ['ghost', 'p1'] }), targetSpace, false)
    const third = await mapper.prepareDocumentData(makeDoc({ approvers: ['p1', 'p3'] }), targetSpace, false)

    expect(first.approvers).toEqual(['p1'])
    expect(second.approvers).toEqual(['p1'])
    expect(third.approvers).toEqual(['p1'])

    const calls = personQueries(client)
    // First document checks p1 + ghost, second is served from cache, third checks only p3
    expect(calls).toHaveLength(2)
    expect(calls[1][1]._id.$in).toEqual(['p3'])
  })

  it('does not query persons for empty arrays or classes without person attributes', async () => {
    const client = createTargetClient([])
    const mapper = new DataMapper(context, client, createState(), {}, undefined)

    await mapper.prepareDocumentData(makeDoc({ approvers: [], reviewers: [] }), targetSpace, false)
    await mapper.prepareDocumentData(makeDoc({ title: 'x' }, otherDocClass), targetSpace, false)

    expect(personQueries(client)).toHaveLength(0)
  })

  it('respects field mappers that reset team members', async () => {
    const client = createTargetClient(['p1'])
    const mapper = new DataMapper(
      context,
      client,
      createState(),
      { [docClass]: { approvers: [], externalApprovers: [], coAuthors: [], reviewers: [] } },
      undefined
    )

    const result = await mapper.prepareDocumentData(
      makeDoc({ approvers: ['p1', 'ghost'], coAuthors: ['ghost'], reviewers: ['p1'] }),
      targetSpace,
      false
    )

    expect(result.approvers).toEqual([])
    expect(result.coAuthors).toEqual([])
    expect(result.reviewers).toEqual([])
    expect(result.externalApprovers).toEqual([])
    expect(personQueries(client)).toHaveLength(0)
  })

  it('checks refs after id remapping', async () => {
    const client = createTargetClient(['target-p1'])
    const state = createState()
    // A person exported in the same batch gets a new id in the target workspace
    state.idMapping.set('source-p1' as Ref<Doc>, 'target-p1' as Ref<Doc>)
    const mapper = new DataMapper(context, client, state, {}, undefined)

    const result = await mapper.prepareDocumentData(makeDoc({ approvers: ['source-p1', 'ghost'] }), targetSpace, false)

    expect(result.approvers).toEqual(['target-p1'])
  })
})
