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

import { type PermissionsStore } from '@hcengineering/contact'
import core, {
  AccountRole,
  setCurrentAccount,
  type Account,
  type AccountUuid,
  type Class,
  type Doc,
  type PersonId,
  type Ref,
  type Space,
  type TypedSpace
} from '@hcengineering/core'
import type { Permissions } from '../permissions'

interface MockReadable<T> {
  subscribe: (listener: (value: T) => void) => () => void
}

interface MockWritable<T> extends MockReadable<T> {
  set: (value: T) => void
}

function mockWritable<T> (initialValue: T): MockWritable<T> {
  let value = initialValue
  const listeners = new Set<(value: T) => void>()

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      listener(value)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (nextValue) => {
      value = nextValue
      for (const listener of listeners) {
        listener(value)
      }
    }
  }
}

function mockDerived<T> (stores: Array<MockReadable<unknown>>, derive: (values: unknown[]) => T): MockReadable<T> {
  const values: unknown[] = new Array(stores.length)
  const initialized = new Set<number>()
  const result = mockWritable<T | undefined>(undefined)

  stores.forEach((store, index) => {
    store.subscribe((value) => {
      values[index] = value
      initialized.add(index)
      if (initialized.size === stores.length) {
        result.set(derive(values))
      }
    })
  })

  return result as MockReadable<T>
}

function mockGet<T> (store: MockReadable<T>): T {
  let current: T | undefined
  const unsubscribe = store.subscribe((value) => {
    current = value
  })
  unsubscribe()
  return current as T
}

jest.doMock('svelte/store', () => ({
  derived: mockDerived,
  get: mockGet,
  readable: <T> (value: T) => mockWritable(value),
  writable: mockWritable
}))

jest.doMock('@hcengineering/contact', () => ({
  __esModule: true,
  default: {
    store: {
      Permissions: 'contact:store:Permissions'
    }
  }
}))

function emptyPermissionsStore (): PermissionsStore {
  return {
    ps: {},
    ap: {},
    ms: {},
    whitelist: new Set(),
    restrictedSpaces: new Set()
  }
}

const mockPermissionsData = mockWritable<PermissionsStore>(emptyPermissionsStore())

// The real store is derived and emits a new object on every change, so tests must do the same
// instead of mutating the current value in place.
function setPermissionsStore (patch: Partial<PermissionsStore>): void {
  mockPermissionsData.set({ ...emptyPermissionsStore(), ...patch })
}

jest.doMock('@hcengineering/platform', () => ({
  getMetadata: jest.fn(() => false),
  getResource: jest.fn(async () => mockPermissionsData)
}))

jest.doMock('@hcengineering/presentation', () => ({
  getClient: jest.fn(() => ({
    getHierarchy: jest.fn(() => ({
      getAncestors: jest.fn(() => []),
      isDerived: jest.fn((objectClass: Ref<Class<Doc>>, baseClass: Ref<Class<Doc>>) => objectClass === baseClass),
      isMixin: jest.fn(() => false)
    })),
    getModel: jest.fn(() => ({
      findAllSync: jest.fn(() => [])
    }))
  }))
}))

const mockRestrictions = mockWritable({
  readonly: false,
  disableComments: false,
  disableNavigation: false,
  disableActions: false
})

jest.doMock('../utils', () => ({
  restrictionStore: mockRestrictions
}))

let getPermissions: () => Permissions

function createAccount (role: AccountRole, uuid: string = 'account'): Account {
  return {
    uuid: uuid as AccountUuid,
    role,
    primarySocialId: `${uuid}:primary` as PersonId,
    socialIds: [`${uuid}:primary` as PersonId],
    fullSocialIds: []
  }
}

function createSpace (
  id: string,
  objectClass: Ref<Class<Space>>,
  members: AccountUuid[] = [],
  createdBy?: PersonId
): Space {
  const result: Space = {
    _id: id as Ref<Space>,
    _class: objectClass,
    space: core.space.Space,
    name: id,
    description: '',
    members,
    private: false,
    archived: false,
    createdBy,
    modifiedBy: 'system' as PersonId,
    modifiedOn: 0
  }
  return result
}

describe('permissions', () => {
  beforeAll(async () => {
    const permissionsModule = await import('../permissions')
    getPermissions = permissionsModule.getPermissions
    await Promise.resolve()
  })

  beforeEach(async () => {
    setPermissionsStore({})
    mockRestrictions.set({
      readonly: false,
      disableComments: false,
      disableNavigation: false,
      disableActions: false
    })
    await Promise.resolve()
  })

  test.each([AccountRole.Guest, AccountRole.DocGuest, AccountRole.ReadOnlyGuest])(
    'denies generic CRUD operations for %s',
    (role) => {
      const space = createSpace('channel', core.class.Space)
      const doc = {
        _id: 'doc' as Ref<Doc>,
        _class: 'test:class:Doc' as Ref<Class<Doc>>,
        space: space._id,
        modifiedBy: 'system' as PersonId,
        modifiedOn: 0
      }
      setPermissionsStore({ whitelist: new Set([space._id]) })
      setCurrentAccount(createAccount(role))

      const current = getPermissions()

      expect(current.canCreate(doc._class, space._id)).toBe(false)
      expect(current.canEdit(doc)).toBe(false)
      expect(current.canRemove(doc)).toBe(false)
    }
  )

  test('allows a channel member to add members but not remove them', () => {
    const account = createAccount(AccountRole.User)
    const space = createSpace('channel', core.class.Space, [account.uuid])
    setCurrentAccount(account)

    const current = getPermissions()

    expect(current.canAddMembers(space)).toBe(true)
    expect(current.canRemoveMembers(space)).toBe(false)
  })

  test('allows the space creator to add and remove members', () => {
    const account = createAccount(AccountRole.User)
    const space = createSpace('channel', core.class.Space, [account.uuid], account.primarySocialId)
    setCurrentAccount(account)

    const current = getPermissions()

    expect(current.canAddMembers(space)).toBe(true)
    expect(current.canRemoveMembers(space)).toBe(true)
  })

  test('keeps archive and update permissions independent', () => {
    const account = createAccount(AccountRole.User)
    const space = createSpace('project', core.class.TypedSpace) as TypedSpace
    setPermissionsStore({ ps: { [space._id]: new Set([core.permission.ArchiveSpace]) } })
    setCurrentAccount(account)

    let current = getPermissions()

    expect(current.canArchiveSpace(space)).toBe(true)
    expect(current.canEditSpace(space)).toBe(false)

    setPermissionsStore({ ps: { [space._id]: new Set([core.permission.UpdateSpace]) } })
    current = getPermissions()

    expect(current.canArchiveSpace(space)).toBe(false)
    expect(current.canEditSpace(space)).toBe(true)
  })

  test('denies everything but reading for a read only guest link', () => {
    const account = createAccount(AccountRole.User)
    const space = createSpace('channel', core.class.Space, [account.uuid], account.primarySocialId)
    const doc = {
      _id: 'doc' as Ref<Doc>,
      _class: 'test:class:Doc' as Ref<Class<Doc>>,
      space: space._id,
      modifiedBy: 'system' as PersonId,
      modifiedOn: 0
    }
    setPermissionsStore({ whitelist: new Set([space._id]) })
    setCurrentAccount(account)
    mockRestrictions.set({
      readonly: true,
      disableComments: false,
      disableNavigation: false,
      disableActions: false
    })

    const current = getPermissions()

    expect(current.canEdit(doc)).toBe(false)
    expect(current.canAddMembers(space)).toBe(false)
    expect(current.canRemoveMembers(space)).toBe(false)
    expect(current.canComment(doc)).toBe(false)
    expect(current.canTrackReadStatus).toBe(false)
  })

  test.each([
    [AccountRole.ReadOnlyGuest, false],
    [AccountRole.DocGuest, true]
  ])('resolves commenting for %s to %s', (role, expected) => {
    const doc = {
      _id: 'doc' as Ref<Doc>,
      _class: 'test:class:Doc' as Ref<Class<Doc>>,
      space: core.space.Space,
      modifiedBy: 'system' as PersonId,
      modifiedOn: 0
    }
    setCurrentAccount(createAccount(role))

    const current = getPermissions()

    expect(current.canComment(doc)).toBe(expected)
    expect(current.canReact(doc)).toBe(expected)
    expect(current.canTrackReadStatus).toBe(role !== AccountRole.ReadOnlyGuest)
  })

  test('allows a guest to work with the documents it created', () => {
    const account = createAccount(AccountRole.Guest)
    const space = createSpace('channel', core.class.Space)
    const own = {
      _id: 'own' as Ref<Doc>,
      _class: 'test:class:Doc' as Ref<Class<Doc>>,
      space: space._id,
      createdBy: account.primarySocialId,
      modifiedBy: account.primarySocialId,
      modifiedOn: 0
    }
    const foreign = { ...own, _id: 'foreign' as Ref<Doc>, createdBy: 'someone:primary' as PersonId }
    setPermissionsStore({ whitelist: new Set([space._id]) })
    setCurrentAccount(account)

    const current = getPermissions()

    expect(current.canEdit(own)).toBe(true)
    expect(current.canRemove(own)).toBe(true)
    expect(current.canComment(own)).toBe(true)
    expect(current.canReact(own)).toBe(true)

    expect(current.canEdit(foreign)).toBe(false)
    expect(current.canRemove(foreign)).toBe(false)
    expect(current.canComment(foreign)).toBe(false)
  })

  test.each([AccountRole.DocGuest, AccountRole.ReadOnlyGuest])(
    'does not extend own document rights to %s, the server rejects all their transactions',
    (role) => {
      const account = createAccount(role)
      const space = createSpace('channel', core.class.Space)
      const own = {
        _id: 'own' as Ref<Doc>,
        _class: 'test:class:Doc' as Ref<Class<Doc>>,
        space: space._id,
        createdBy: account.primarySocialId,
        modifiedBy: account.primarySocialId,
        modifiedOn: 0
      }
      setPermissionsStore({ whitelist: new Set([space._id]) })
      setCurrentAccount(account)

      const current = getPermissions()

      expect(current.canEdit(own)).toBe(false)
      expect(current.canRemove(own)).toBe(false)
    }
  )

  test('does not let a read only link bypass own document rights', () => {
    const account = createAccount(AccountRole.Guest)
    const space = createSpace('channel', core.class.Space)
    const own = {
      _id: 'own' as Ref<Doc>,
      _class: 'test:class:Doc' as Ref<Class<Doc>>,
      space: space._id,
      createdBy: account.primarySocialId,
      modifiedBy: account.primarySocialId,
      modifiedOn: 0
    }
    setPermissionsStore({ whitelist: new Set([space._id]) })
    setCurrentAccount(account)
    mockRestrictions.set({
      readonly: true,
      disableComments: false,
      disableNavigation: false,
      disableActions: false
    })

    const current = getPermissions()

    expect(current.canEdit(own)).toBe(false)
    expect(current.canComment(own)).toBe(false)
  })

  test('denies commenting when the guest link disables comments', () => {
    const doc = {
      _id: 'doc' as Ref<Doc>,
      _class: 'test:class:Doc' as Ref<Class<Doc>>,
      space: core.space.Space,
      modifiedBy: 'system' as PersonId,
      modifiedOn: 0
    }
    setCurrentAccount(createAccount(AccountRole.User))
    mockRestrictions.set({
      readonly: false,
      disableComments: true,
      disableNavigation: false,
      disableActions: false
    })

    const current = getPermissions()

    expect(current.canComment(doc)).toBe(false)
    expect(current.canViewActivity(doc)).toBe(false)
  })
})
