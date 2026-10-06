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

import chunter, { type DefaultDiscussion, type Discussion } from '@hcengineering/chunter'
import core, { type Class, type Doc, type Ref, type Tx, TxFactory, type TxUpdateDoc } from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'

import { OnDefaultDiscussionRenamed, OnDefaultDiscussionUpdated, OnDiscussionOwnerClassChanged } from '../index'

const Task = 'card:class:Task' as Ref<Class<Doc>>
const Bug = 'card:class:Bug' as Ref<Class<Doc>>
const factory = new TxFactory(core.account.System)

function matches (doc: Record<string, any>, query: Record<string, any>): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && '$ne' in value) return doc[key] !== value.$ne
    if (value !== null && typeof value === 'object' && '$in' in value) return value.$in.includes(doc[key])
    return doc[key] === value
  })
}

function config (_id: string, ofClass: Ref<Class<Doc>>, name: string): DefaultDiscussion {
  return {
    _id: _id as Ref<DefaultDiscussion>,
    _class: chunter.class.DefaultDiscussion,
    space: core.space.Model,
    modifiedBy: core.account.System,
    modifiedOn: 0,
    ofClass,
    name,
    visibility: 'participants'
  }
}

function discussion (
  _id: string,
  name: string,
  attachedToClass: Ref<Class<Doc>>,
  defaultDiscussion?: string
): Discussion {
  return {
    _id: _id as Ref<Discussion>,
    _class: chunter.class.Discussion,
    space: 'space' as any,
    modifiedBy: core.account.System,
    modifiedOn: 0,
    attachedTo: 'card' as Ref<Doc>,
    attachedToClass,
    collection: 'discussions',
    name,
    resolved: false,
    members: [],
    ...(defaultDiscussion !== undefined ? { defaultDiscussion: defaultDiscussion as Ref<DefaultDiscussion> } : {})
  }
}

function createControl (discussions: Discussion[], configs: DefaultDiscussion[]): TriggerControl {
  return {
    ctx: {} as any,
    txFactory: new TxFactory(core.account.System, true),
    findAll: async (_ctx: any, _class: Ref<Class<Doc>>, query: Record<string, any>) =>
      _class === chunter.class.Discussion ? discussions.filter((it) => matches(it, query)) : [],
    modelDb: {
      findAllSync: (_class: Ref<Class<Doc>>, query: Record<string, any>) =>
        _class === chunter.class.DefaultDiscussion ? configs.filter((it) => matches(it, query)) : []
    }
  } as unknown as TriggerControl
}

function updates (txes: Tx[]): Array<{ objectId: string, operations: Record<string, any> }> {
  return txes.map((tx) => {
    const update = tx as TxUpdateDoc<Doc>
    return { objectId: update.objectId, operations: update.operations }
  })
}

describe('OnDefaultDiscussionUpdated', () => {
  const discussions = [
    discussion('d1', 'General', Task, 'c1'),
    discussion('d2', 'Talk', Task, 'c1'),
    discussion('d3', 'General', Task)
  ]

  it('renames the discussions created from the entry', async () => {
    const tx = factory.createTxUpdateDoc(chunter.class.DefaultDiscussion, core.space.Model, 'c1' as any, {
      name: ' Talk '
    })
    const result = await OnDefaultDiscussionUpdated([tx], createControl(discussions, []))
    expect(updates(result)).toEqual([{ objectId: 'd1', operations: { name: 'Talk' } }])
  })

  it('ignores an empty name and other updates', async () => {
    const empty = factory.createTxUpdateDoc(chunter.class.DefaultDiscussion, core.space.Model, 'c1' as any, {
      name: ' '
    })
    const visibility = factory.createTxUpdateDoc(chunter.class.DefaultDiscussion, core.space.Model, 'c1' as any, {
      visibility: 'public'
    })
    expect(await OnDefaultDiscussionUpdated([empty, visibility], createControl(discussions, []))).toEqual([])
  })
})

describe('OnDefaultDiscussionRenamed', () => {
  const rename = (id: string): Tx =>
    factory.createTxUpdateDoc(chunter.class.Discussion, 'space' as any, id as any, { name: 'Renamed' })

  it('restores the name of a configured default discussion', async () => {
    const control = createControl([discussion('d1', 'Renamed', Task, 'c1')], [config('c1', Task, 'General')])
    expect(updates(await OnDefaultDiscussionRenamed([rename('d1')], control))).toEqual([
      { objectId: 'd1', operations: { name: 'General' } }
    ])
  })

  it('keeps the name of a regular discussion or of a removed or foreign entry', async () => {
    const control = createControl(
      [
        discussion('d1', 'Renamed', Task),
        discussion('d2', 'Renamed', Task, 'gone'),
        discussion('d3', 'Renamed', Task, 'c2')
      ],
      [config('c2', Bug, 'General')]
    )
    expect(await OnDefaultDiscussionRenamed([rename('d1'), rename('d2'), rename('d3')], control)).toEqual([])
  })

  it('does nothing when the name already matches', async () => {
    const control = createControl([discussion('d1', 'General', Task, 'c1')], [config('c1', Task, 'General')])
    expect(await OnDefaultDiscussionRenamed([rename('d1')], control)).toEqual([])
  })
})

describe('OnDiscussionOwnerClassChanged', () => {
  const changeType = (): Tx => factory.createTxUpdateDoc(Task, 'space' as any, 'card' as any, { _class: Bug } as any)

  it('moves discussions and relinks a default discussion by name', async () => {
    const control = createControl(
      [discussion('d1', 'General', Task, 'c1'), discussion('d2', 'Notes', Task)],
      [config('c1', Task, 'General'), config('c2', Bug, 'General')]
    )
    expect(updates(await OnDiscussionOwnerClassChanged([changeType()], control))).toEqual([
      { objectId: 'd1', operations: { attachedToClass: Bug, defaultDiscussion: 'c2' } },
      { objectId: 'd2', operations: { attachedToClass: Bug } }
    ])
  })

  it('turns a default discussion without a matching entry into a regular one', async () => {
    const control = createControl(
      [discussion('d1', 'General', Task, 'c1')],
      [config('c1', Task, 'General'), config('c2', Bug, 'Review')]
    )
    expect(updates(await OnDiscussionOwnerClassChanged([changeType()], control))).toEqual([
      { objectId: 'd1', operations: { attachedToClass: Bug, $unset: { defaultDiscussion: true } } }
    ])
  })

  it('does not link two discussions to the same entry', async () => {
    const control = createControl(
      [discussion('d1', 'General', Task, 'c1'), discussion('d2', 'General', Task, 'c3')],
      [config('c1', Task, 'General'), config('c3', Task, 'General'), config('c2', Bug, 'General')]
    )
    const result = updates(await OnDiscussionOwnerClassChanged([changeType()], control))
    expect(result.filter((it) => it.operations.defaultDiscussion === 'c2')).toHaveLength(1)
    expect(result.filter((it) => it.operations.$unset !== undefined)).toHaveLength(1)
  })

  it('ignores updates that do not change the class', async () => {
    const tx = factory.createTxUpdateDoc(Task, 'space' as any, 'card' as any, { title: 'x' } as any)
    const control = createControl([discussion('d1', 'General', Task, 'c1')], [])
    expect(await OnDiscussionOwnerClassChanged([tx], control)).toEqual([])
  })
})
