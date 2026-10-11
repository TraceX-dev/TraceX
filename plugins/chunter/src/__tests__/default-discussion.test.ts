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

import core, {
  type AccountUuid,
  type Class,
  type Doc,
  type ObjectVisibility,
  type Ref,
  type Space,
  type TxOperations
} from '@hcengineering/core'

import chunter, { type DefaultDiscussion } from '..'
import { getDefaultDiscussionVisibility, getOrCreateDefaultDiscussion, withDiscussionVisibility } from '../utils'

const me = 'me' as AccountUuid
const card: Doc = {
  _id: 'card' as Ref<Doc>,
  _class: 'card:class:Task' as Ref<Class<Doc>>,
  space: 'space' as Ref<Space>,
  modifiedBy: 'me' as any,
  modifiedOn: 0
}

function config (visibility: ObjectVisibility): DefaultDiscussion {
  return {
    _id: 'config' as Ref<DefaultDiscussion>,
    _class: chunter.class.DefaultDiscussion,
    space: core.space.Model,
    modifiedBy: 'me' as any,
    modifiedOn: 0,
    ofClass: card._class,
    name: 'General',
    visibility
  }
}

interface StoredDoc {
  _id: string
  _class: string
  attachedTo?: string
  [key: string]: any
}

function matches (doc: StoredDoc, query: Record<string, any>): boolean {
  return Object.entries(query).every(([key, value]) => doc[key] === value)
}

/**
 * An in-memory client. A discussion listed in `hidden` is visible only to collaborators of the card,
 * while the notMatch check of apply sees every document, like the server does.
 */
function createClient (docs: StoredDoc[], hidden = new Set<string>()): { client: TxOperations, docs: StoredDoc[] } {
  let counter = 0
  const isCollaborator = (): boolean =>
    docs.some((it) => it._class === core.class.Collaborator && it.collaborator === me)
  const visible = (doc: StoredDoc): boolean => !hidden.has(doc._id) || isCollaborator()

  const findOne = async (_class: string, query: Record<string, any>): Promise<StoredDoc | undefined> =>
    docs.find((it) => it._class === _class && matches(it, query) && visible(it))

  const addCollection = async (
    _class: string,
    space: string,
    attachedTo: string,
    attachedToClass: string,
    collection: string,
    attributes: Record<string, any>,
    target: StoredDoc[] = docs
  ): Promise<string> => {
    const _id = `doc${++counter}`
    target.push({ ...attributes, _id, _class, space, attachedTo, attachedToClass, collection })
    return _id
  }

  const client = {
    findOne,
    addCollection,
    apply: () => {
      const pending: StoredDoc[] = []
      const notMatches: Array<{ _class: string, query: Record<string, any> }> = []
      return {
        notMatch: (_class: string, query: Record<string, any>) => notMatches.push({ _class, query }),
        findOne,
        addCollection: async (...args: [string, string, string, string, string, Record<string, any>]) =>
          await addCollection(...args, pending),
        commit: async () => {
          const result = !notMatches.some(({ _class, query }) =>
            docs.some((it) => it._class === _class && matches(it, query))
          )
          if (result) docs.push(...pending)
          return { result }
        }
      }
    }
  }
  return { client: client as unknown as TxOperations, docs }
}

function createHiddenDiscussion (): StoredDoc {
  return { _id: 'hidden', _class: chunter.class.Discussion, attachedTo: card._id, defaultDiscussion: 'config' }
}

const discussions = (docs: StoredDoc[]): StoredDoc[] => docs.filter((it) => it._class === chunter.class.Discussion)
const collaborators = (docs: StoredDoc[]): StoredDoc[] => docs.filter((it) => it._class === core.class.Collaborator)

describe('getDefaultDiscussionVisibility', () => {
  it('keeps public and participants and replaces private', () => {
    expect(getDefaultDiscussionVisibility({ visibility: 'public' })).toBe('public')
    expect(getDefaultDiscussionVisibility({ visibility: 'participants' })).toBe('participants')
    expect(getDefaultDiscussionVisibility({ visibility: 'private' })).toBe('participants')
  })
})

describe('withDiscussionVisibility', () => {
  const data = { name: 'General', resolved: false, members: [] }

  it('adds no policy for a public discussion', () => {
    expect(withDiscussionVisibility(data, 'public')).toEqual(data)
  })

  it('adds the read policy otherwise', () => {
    const result = withDiscussionVisibility(data, 'participants') as any
    expect(result[core.mixin.AccessControlled]).toBeDefined()
    expect(result.name).toBe('General')
  })
})

describe('getOrCreateDefaultDiscussion', () => {
  it('returns an existing visible discussion without creating one', async () => {
    const { client, docs } = createClient([
      { _id: 'existing', _class: chunter.class.Discussion, attachedTo: card._id, defaultDiscussion: 'config' }
    ])
    expect(await getOrCreateDefaultDiscussion(client, card, config('participants'), me)).toBe('existing')
    expect(discussions(docs)).toHaveLength(1)
    expect(collaborators(docs)).toHaveLength(0)
  })

  it('creates a participants discussion and makes the creator a collaborator', async () => {
    const { client, docs } = createClient([])
    const id = await getOrCreateDefaultDiscussion(client, card, config('participants'), me)
    const [created] = discussions(docs)
    expect(created._id).toBe(id)
    expect(created).toMatchObject({ name: 'General', members: [], defaultDiscussion: 'config', attachedTo: card._id })
    expect(created[core.mixin.AccessControlled]).toBeDefined()
    expect(collaborators(docs)).toHaveLength(1)
  })

  it('creates a public discussion without a policy and collaborator', async () => {
    const { client, docs } = createClient([])
    await getOrCreateDefaultDiscussion(client, card, config('public'), me)
    expect(discussions(docs)[0][core.mixin.AccessControlled]).toBeUndefined()
    expect(collaborators(docs)).toHaveLength(0)
  })

  it('creates a stored private entry as a participants discussion', async () => {
    const { client, docs } = createClient([])
    await getOrCreateDefaultDiscussion(client, card, config('private'), me)
    expect(discussions(docs)[0].members).toEqual([])
    expect(collaborators(docs)).toHaveLength(1)
  })

  it('does not duplicate a hidden discussion and opens it after joining the card', async () => {
    const hidden = createHiddenDiscussion()
    const { client, docs } = createClient([hidden], new Set(['hidden']))
    expect(await getOrCreateDefaultDiscussion(client, card, config('participants'), me)).toBe('hidden')
    expect(discussions(docs)).toHaveLength(1)
    expect(collaborators(docs)).toHaveLength(1)
  })

  it('returns undefined when the existing discussion stays hidden', async () => {
    const hidden = createHiddenDiscussion()
    // Visibility narrowed to the members: being a collaborator does not help.
    const { client, docs } = createClient([hidden], new Set(['hidden']))
    const strict = client as any
    const findOne = strict.findOne
    strict.findOne = async (_class: string, query: Record<string, any>) =>
      _class === chunter.class.Discussion ? undefined : await findOne(_class, query)
    expect(await getOrCreateDefaultDiscussion(strict, card, config('participants'), me)).toBeUndefined()
    expect(discussions(docs)).toHaveLength(1)
  })
})
