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
  type AccountUuid,
  type Class,
  type Collaborator,
  type Doc,
  type Ref,
  type Space,
  type TxOperations
} from '@hcengineering/core'
import { cleanupSpaceCollaborators } from './space-collaborators'

const CHANNEL = 'chunter:class:Channel' as Ref<Class<Space>>
const VACANCY = 'recruit:class:Vacancy' as Ref<Class<Space>>
const ISSUE = 'tracker:class:Issue' as Ref<Class<Doc>>
const DOC_NOTIFY_CONTEXT = 'notification:class:DocNotifyContext'

const OWNER = 'acc-owner' as AccountUuid
const USER = 'acc-user' as AccountUuid
const GUEST = 'acc-guest' as AccountUuid

const space = (_id: string, _class: Ref<Class<Space>>, members: AccountUuid[]): Space =>
  ({ _id, _class, name: _id, members }) as unknown as Space

const collaborator = (attachedTo: string, account: AccountUuid): Collaborator =>
  ({ _id: `${attachedTo}-${account}`, attachedTo, collaborator: account }) as unknown as Collaborator

interface Mock {
  ops: TxOperations
  removed: string[]
}

function createMockOps (spaces: Space[], collaborators: Collaborator[]): Mock {
  const removed: string[] = []
  const ops = {
    getHierarchy: () => ({
      isDerived: (cls: Ref<Class<Doc>>, base: Ref<Class<Doc>>) =>
        base === core.class.Space && (cls === CHANNEL || cls === VACANCY)
    }),
    getModel: () => ({
      findAllSync: () => [
        { attachedTo: CHANNEL, fields: ['members'] },
        // Collaborators of a vacancy do not come from members: never touched.
        { attachedTo: VACANCY, fields: ['createdBy'] },
        { attachedTo: ISSUE, fields: ['assignee'] }
      ]
    }),
    findAll: async (_class: string, query: any) => {
      if (_class === CHANNEL || _class === VACANCY) return spaces.filter((it) => it._class === _class)
      if (_class === core.class.Collaborator) {
        return collaborators.filter((it) => query.attachedTo.$in.includes(it.attachedTo))
      }
      if (_class === contact.mixin.Employee) {
        return [
          { personUuid: OWNER, role: 'USER' },
          { personUuid: USER, role: 'USER' },
          { personUuid: GUEST, role: 'GUEST' }
        ].filter((it) => query.personUuid.$in.includes(it.personUuid))
      }
      if (_class === DOC_NOTIFY_CONTEXT) return [{ _id: `context-${query.objectId}-${query.user}` }]
      return []
    },
    remove: async (doc: Doc) => {
      removed.push(doc._id)
    }
  } as unknown as TxOperations
  return { ops, removed }
}

describe('cleanupSpaceCollaborators', () => {
  const data = (): [Space[], Collaborator[]] => [
    [space('channel-1', CHANNEL, [OWNER]), space('vacancy-1', VACANCY, [OWNER])],
    [
      collaborator('channel-1', OWNER),
      collaborator('channel-1', USER),
      collaborator('channel-1', GUEST),
      collaborator('vacancy-1', GUEST)
    ]
  ]

  it('only reports stale guest collaborators in dry-run mode', async () => {
    const { ops, removed } = createMockOps(...data())
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    const result = await cleanupSpaceCollaborators(ops, { dryRun: true, includeUsers: false })

    expect(result.stale).toEqual([
      { space: 'channel-1', spaceClass: CHANNEL, spaceName: 'channel-1', account: GUEST, role: 'GUEST' }
    ])
    expect(result.removedCollaborators).toBe(0)
    expect(removed).toEqual([])
    logSpy.mockRestore()
  })

  it('removes stale guest collaborators and their notify contexts', async () => {
    const { ops, removed } = createMockOps(...data())

    const result = await cleanupSpaceCollaborators(ops, { dryRun: false, includeUsers: false })

    expect(result).toMatchObject({ removedCollaborators: 1, removedContexts: 1 })
    expect(removed).toEqual(['channel-1-acc-guest', 'context-channel-1-acc-guest'])
  })

  it('includes stale users on request and never touches members or classes with other collaborator fields', async () => {
    const { ops, removed } = createMockOps(...data())

    const result = await cleanupSpaceCollaborators(ops, { dryRun: false, includeUsers: true })

    expect(result.stale.map((it) => it.account).sort()).toEqual([GUEST, USER].sort())
    expect(removed).not.toContain('channel-1-acc-owner')
    expect(removed).not.toContain('vacancy-1-acc-guest')
  })
})
