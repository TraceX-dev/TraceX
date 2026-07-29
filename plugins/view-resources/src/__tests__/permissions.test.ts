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
  readable: <T>(value: T) => mockWritable(value),
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

const mockPermissionsStore: PermissionsStore = {
  ps: {},
  ap: {},
  ms: {},
  whitelist: new Set(),
  restrictedSpaces: new Set()
}

jest.doMock('@hcengineering/platform', () => ({
  getMetadata: jest.fn(() => false),
  getResource: jest.fn(async () => mockWritable(mockPermissionsStore))
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

function resetPermissionStore (): void {
  mockPermissionsStore.ps = {}
  mockPermissionsStore.ap = {}
  mockPermissionsStore.ms = {}
  mockPermissionsStore.whitelist.clear()
  mockPermissionsStore.restrictedSpaces.clear()
}

describe('permissions', () => {
  beforeAll(async () => {
    const permissionsModule = await import('../permissions')
    getPermissions = permissionsModule.getPermissions
    await Promise.resolve()
  })

  beforeEach(async () => {
    resetPermissionStore()
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
      mockPermissionsStore.whitelist.add(space._id)
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
    mockPermissionsStore.ps[space._id] = new Set([core.permission.ArchiveSpace])
    setCurrentAccount(account)

    let current = getPermissions()

    expect(current.canArchiveSpace(space)).toBe(true)
    expect(current.canEditSpace(space)).toBe(false)

    mockPermissionsStore.ps[space._id] = new Set([core.permission.UpdateSpace])
    setCurrentAccount({ ...account })
    current = getPermissions()

    expect(current.canArchiveSpace(space)).toBe(false)
    expect(current.canEditSpace(space)).toBe(true)
  })
})
