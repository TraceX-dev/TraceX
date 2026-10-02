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

import type { IntlString } from '@hcengineering/platform'
import type { AccountUuid, Class, Collaborator, Doc, Domain, Ref, Space } from '../classes'
import { ClassifierKind } from '../classes'
import core from '../component'
import { Hierarchy } from '../hierarchy'
import {
  type AccessFindFn,
  audienceToVisibility,
  canReadByAudience,
  DEFAULT_ACCESS_PARENT,
  getAccessAudience,
  getAccessOwners,
  getAccessParents,
  getAccessPolicyClasses,
  getAccessReaders,
  getAccessRoot,
  getClassAccessPolicy,
  getObjectAccessReaders,
  isAccessAudience,
  isRestrictedAudience,
  objectVisibilities,
  touchesAttribute,
  visibilityToAudience
} from '../objectAccess'
import { TxFactory } from '../tx'
import { genMinModel } from './minmodel'

const txFactory = new TxFactory(core.account.System)

const DOMAIN_TEST = 'test-access' as Domain
const Card = 'class:test.Card' as Ref<Class<Doc>>
const Thread = 'class:test.Thread' as Ref<Class<Doc>>
const SubThread = 'class:test.SubThread' as Ref<Class<Doc>>
const Message = 'class:test.Message' as Ref<Class<Doc>>
const Notice = 'class:test.Notice' as Ref<Class<Doc>>

const alice = 'alice' as AccountUuid
const bob = 'bob' as AccountUuid
const carol = 'carol' as AccountUuid

function buildHierarchy (): Hierarchy {
  const hierarchy = new Hierarchy()
  for (const tx of genMinModel()) hierarchy.tx(tx)
  const classes: Array<[Ref<Class<Doc>>, Ref<Class<Doc>>, ClassifierKind, Domain | undefined]> = [
    [core.mixin.ClassAccessPolicy, core.class.Class, ClassifierKind.MIXIN, undefined],
    [core.mixin.AccessParent, core.class.Class, ClassifierKind.MIXIN, undefined],
    [core.mixin.AccessParticipants, core.class.Class, ClassifierKind.MIXIN, undefined],
    [core.mixin.AccessControlled, core.class.Doc, ClassifierKind.MIXIN, undefined],
    [core.class.Collaborator, core.class.AttachedDoc, ClassifierKind.CLASS, DOMAIN_TEST],
    [Card, core.class.Doc, ClassifierKind.CLASS, DOMAIN_TEST],
    [Thread, core.class.AttachedDoc, ClassifierKind.CLASS, DOMAIN_TEST],
    [SubThread, Thread, ClassifierKind.CLASS, undefined],
    [Message, core.class.AttachedDoc, ClassifierKind.CLASS, DOMAIN_TEST],
    [Notice, core.class.Doc, ClassifierKind.CLASS, DOMAIN_TEST]
  ]
  for (const [_id, _extends, kind, domain] of classes) {
    hierarchy.tx(
      txFactory.createTxCreateDoc(
        core.class.Class,
        core.space.Model,
        { label: _id as unknown as IntlString, extends: _extends, kind, domain },
        _id
      )
    )
  }
  hierarchy.tx(
    txFactory.createTxMixin(Thread, core.class.Class, core.space.Model, core.mixin.ClassAccessPolicy, {
      membersField: 'members'
    })
  )
  hierarchy.tx(
    txFactory.createTxMixin(Notice, core.class.Class, core.space.Model, core.mixin.AccessParent, {
      parents: [{ field: 'objectId', classField: 'objectClass' }]
    })
  )
  return hierarchy
}

function thread (
  _id: string,
  read: unknown | undefined,
  members: AccountUuid[],
  extra: Record<string, unknown> = {}
): Doc {
  return {
    _id: _id as Ref<Doc>,
    _class: Thread,
    space: 'space' as Ref<Space>,
    modifiedOn: 0,
    modifiedBy: core.account.System,
    attachedTo: 'card1' as Ref<Doc>,
    attachedToClass: Card,
    collection: 'threads',
    members,
    ...(read !== undefined ? { [core.mixin.AccessControlled]: { read }, accessRoot: _id } : {}),
    ...extra
  } as unknown as Doc
}

function collaborator (account: AccountUuid, attachedTo: string): Collaborator {
  return {
    _id: `collab-${account}` as Ref<Collaborator>,
    _class: core.class.Collaborator,
    space: 'space' as Ref<Space>,
    modifiedOn: 0,
    modifiedBy: core.account.System,
    attachedTo: attachedTo as Ref<Doc>,
    attachedToClass: Card,
    collection: 'collaborators',
    collaborator: account
  }
}

function finder (docs: Doc[]): AccessFindFn {
  return async (_class, query) => {
    const q = query as Record<string, unknown>
    return docs.filter((doc) => {
      if (q._id !== undefined && doc._id !== q._id) return false
      if (q.attachedTo !== undefined && (doc as unknown as Record<string, unknown>).attachedTo !== q.attachedTo) {
        return false
      }
      return doc._class === _class || (_class === Thread && doc._class === SubThread)
    }) as any
  }
}

describe('object access', () => {
  it('maps visibility to audience and back', () => {
    for (const visibility of objectVisibilities) {
      expect(audienceToVisibility(visibilityToAudience(visibility))).toBe(visibility)
    }
    expect(audienceToVisibility(undefined)).toBe('public')
    expect(isRestrictedAudience(undefined)).toBe(false)
    expect(isRestrictedAudience({ kind: 'space' })).toBe(false)
    expect(isRestrictedAudience({ kind: 'members' })).toBe(true)
    expect(isRestrictedAudience({ kind: 'parentParticipants' })).toBe(true)
  })

  it('validates audiences', () => {
    expect(isAccessAudience({ kind: 'members' })).toBe(true)
    expect(isAccessAudience({ kind: 'role' })).toBe(false)
    expect(isAccessAudience(null)).toBe(false)
    expect(isAccessAudience('members')).toBe(false)
  })

  it('computes readers per audience', () => {
    const members = new Set([alice])
    const participants = new Set([bob])
    expect(canReadByAudience(carol, { kind: 'space' }, members, participants)).toBe(true)
    expect(canReadByAudience(alice, { kind: 'members' }, members, participants)).toBe(true)
    expect(canReadByAudience(bob, { kind: 'members' }, members, participants)).toBe(false)
    expect(canReadByAudience(bob, { kind: 'parentParticipants' }, members, participants)).toBe(true)
    // Members of the object do not matter for the participants level.
    expect(canReadByAudience(alice, { kind: 'parentParticipants' }, members, participants)).toBe(false)
    expect(canReadByAudience(carol, { kind: 'parentParticipants' }, members, participants)).toBe(false)
    expect(canReadByAudience(bob, { kind: 'parentParticipants' }, members, undefined)).toBe(false)

    expect(getAccessReaders({ kind: 'space' }, members, participants)).toBeUndefined()
    expect(getAccessReaders({ kind: 'members' }, members, participants)).toEqual(new Set([alice]))
    expect(getAccessReaders({ kind: 'parentParticipants' }, members, participants)).toEqual(new Set([bob]))
  })

  it('reads class policies and parents through the class hierarchy', () => {
    const hierarchy = buildHierarchy()
    expect(getClassAccessPolicy(hierarchy, Thread)?.membersField).toBe('members')
    expect(getClassAccessPolicy(hierarchy, SubThread)?.membersField).toBe('members')
    expect(getClassAccessPolicy(hierarchy, Message)).toBeUndefined()
    expect(getClassAccessPolicy(hierarchy, 'class:unknown' as Ref<Class<Doc>>)).toBeUndefined()
    expect(getAccessParents(hierarchy, Message)).toEqual([DEFAULT_ACCESS_PARENT])
    expect(getAccessParents(hierarchy, Notice)).toEqual([{ field: 'objectId', classField: 'objectClass' }])
    // Only declaring classes: a query by a class covers its subclasses.
    expect(getAccessPolicyClasses(hierarchy)).toEqual([Thread])
  })

  it('reads the audience and the mark of a document', () => {
    const hierarchy = buildHierarchy()
    expect(getAccessAudience(hierarchy, thread('t1', { kind: 'members' }, [alice]))).toEqual({ kind: 'members' })
    expect(getAccessAudience(hierarchy, thread('t2', undefined, [alice]))).toBeUndefined()
    expect(getAccessAudience(hierarchy, thread('t3', { kind: 'bogus' }, [alice]))).toBeUndefined()
    expect(getAccessRoot(thread('t1', { kind: 'members' }, [alice]))).toBe('t1')
    expect(getAccessRoot(thread('t2', undefined, [alice]))).toBeUndefined()
  })

  it('detects updates of an attribute, including dotted paths', () => {
    expect(touchesAttribute({ members: [] }, 'members')).toBe(true)
    expect(touchesAttribute({ 'members.0': alice }, 'members')).toBe(true)
    expect(touchesAttribute({ $push: { members: alice } }, 'members')).toBe(true)
    expect(touchesAttribute({ $pull: { 'members.0': alice } }, 'members')).toBe(true)
    expect(touchesAttribute({ membersCount: 1 }, 'members')).toBe(false)
    expect(touchesAttribute({ name: 'x' }, 'members')).toBe(false)
    const mixin = core.mixin.AccessControlled as string
    expect(touchesAttribute({ [`${mixin}.read`]: { kind: 'space' } }, mixin)).toBe(true)
  })

  it('reads owners of a policy', () => {
    const hierarchy = buildHierarchy()
    const doc = thread('t1', { kind: 'members' }, [alice])
    ;(doc as any)[core.mixin.AccessControlled].owners = [bob]
    expect(getAccessOwners(hierarchy, doc)).toEqual([bob])
    expect(getAccessOwners(hierarchy, thread('t2', undefined, [alice]))).toEqual([])
  })

  it('resolves readers of a restricted object for triggers', async () => {
    const hierarchy = buildHierarchy()
    const privateThread = thread('private', { kind: 'members' }, [alice])
    const participantsThread = thread('participants', { kind: 'parentParticipants' }, [alice])
    const publicThread = thread('public', { kind: 'space' }, [alice])
    const docs: Doc[] = [privateThread, participantsThread, publicThread, collaborator(bob, 'card1')]
    const find = finder(docs)

    const message = (root: string): Doc =>
      ({ _id: `m-${root}`, _class: Message, space: 'space', accessRoot: root }) as unknown as Doc

    expect(await getObjectAccessReaders(hierarchy, find, thread('plain', undefined, [alice]))).toBeUndefined()
    expect(await getObjectAccessReaders(hierarchy, find, privateThread)).toEqual(new Set([alice]))
    expect(await getObjectAccessReaders(hierarchy, find, message('private'))).toEqual(new Set([alice]))
    expect(await getObjectAccessReaders(hierarchy, find, message('participants'))).toEqual(new Set([bob]))
    expect(await getObjectAccessReaders(hierarchy, find, message('public'))).toBeUndefined()
    // An unknown root fails closed.
    expect(await getObjectAccessReaders(hierarchy, find, message('missing'))).toEqual(new Set())
  })
})
