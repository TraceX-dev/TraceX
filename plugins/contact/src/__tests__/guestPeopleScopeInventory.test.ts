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

/**
 * Inventory of person pickers and how each of them narrows people offered to guests.
 *
 * Guests are offered only people of the current object (space members ∪ object collaborators ∪ themselves).
 * The narrowing is applied by a few popups (chokepoints) from the scope the caller passes as `peopleScope`
 * or, when the caller passes nothing, from the ambient scope of the opened object view (`providePeopleScope`).
 * A picker without any scope is reported at runtime (`UNSCOPED_PEOPLE_WARNING`), UI tests fail on it.
 *
 * This test makes every new usage of a picker a conscious decision: a file using a picker that is not
 * classified below fails the test. Classify it:
 * - `forwards`: passes an explicit `peopleScope` (preferred when the object/space is known);
 * - `editor`: an attribute editor forwarding `space`/`object` to a picker that builds the scope from them;
 * - `optOut`: passes `peopleScope: null`, the people are not tied to an object (direct messages, channels);
 * - `ambient`: used inside an object view, relies on its ambient scope;
 * - `notForGuests`: administration and modules not available to guests;
 * - `declaration`: not a usage (e.g. resource declaration).
 */

// This package is built without Node.js typings: declare the few Node.js APIs the test uses.
interface NodeFs {
  readdirSync: (path: string) => string[]
  readFileSync: (path: string, encoding: 'utf-8') => string
  statSync: (path: string) => { isDirectory: () => boolean }
}
interface NodePath {
  join: (...paths: string[]) => string
  relative: (from: string, to: string) => string
  sep: string
}
declare const require: (id: string) => unknown
// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __dirname: string

const { readdirSync, readFileSync, statSync } = require('fs') as NodeFs
const { join, relative, sep } = require('path') as NodePath

type Kind = 'forwards' | 'editor' | 'optOut' | 'ambient' | 'notForGuests' | 'declaration'

const PLUGINS_DIR = join(__dirname, '..', '..', '..')

/** Popups querying people for selection. Each must apply the guest narrowing itself. */
const CHOKEPOINTS: Record<string, RegExp> = {
  'contact-resources/src/components/UsersPopup.svelte': /createGuestPeopleFilter/,
  'contact-resources/src/components/UsersList.svelte': /createGuestPeopleFilter/,
  'contact-resources/src/components/AssigneePopup.svelte': /createGuestPeopleFilter/,
  'text-editor-resources/src/components/MentionPopup.svelte': /resolvePeopleScope\(peopleScope, \$ambientPeopleScope\)/
}

const PICKERS = [
  'UserBox',
  'UserBoxList',
  'UserBoxItems',
  'UsersPopup',
  'SelectUsersPopup',
  'UsersList',
  'AssigneeBox',
  'AssigneePopup',
  'EmployeeBox',
  'AccountBox',
  'AccountArrayEditor',
  'PersonIdArrayEditor',
  'ContactArrayEditor',
  'ContactList',
  'EmployeeEditor',
  'EmployeeArrayEditor',
  'PersonEditor',
  'EmployeeAttributePresenter',
  'EmployeeRefPresenter',
  'MentionPopup'
]

const INVENTORY: Record<string, { kind: Kind, reason?: string }> = {
  // contact-resources: building blocks forwarding the scope down to the chokepoints
  'contact-resources/src/components/AccountArrayEditor.svelte': { kind: 'forwards' },
  'contact-resources/src/components/AccountBox.svelte': { kind: 'forwards' },
  'contact-resources/src/components/AssigneeBox.svelte': { kind: 'forwards' },
  'contact-resources/src/components/ContactArrayEditor.svelte': { kind: 'forwards' },
  'contact-resources/src/components/ContactList.svelte': { kind: 'forwards' },
  'contact-resources/src/components/EmployeeArrayEditor.svelte': { kind: 'forwards' },
  'contact-resources/src/components/EmployeeAttributePresenter.svelte': { kind: 'forwards' },
  'contact-resources/src/components/EmployeeBox.svelte': { kind: 'forwards' },
  'contact-resources/src/components/EmployeeEditor.svelte': { kind: 'forwards' },
  'contact-resources/src/components/EmployeeRefPresenter.svelte': { kind: 'forwards' },
  'contact-resources/src/components/PersonEditor.svelte': { kind: 'forwards' },
  'contact-resources/src/components/PersonIdArrayEditor.svelte': { kind: 'forwards' },
  'contact-resources/src/components/SelectUsersPopup.svelte': { kind: 'forwards' },
  'contact-resources/src/components/UserBox.svelte': { kind: 'forwards' },
  'contact-resources/src/components/UserBoxItems.svelte': { kind: 'forwards' },
  'contact-resources/src/components/UserBoxList.svelte': { kind: 'forwards' },
  'contact-resources/src/components/AddMembersPopup.svelte': { kind: 'notForGuests', reason: 'space membership' },
  'contact-resources/src/components/Members.svelte': { kind: 'notForGuests', reason: 'organization members (CRM)' },
  'contact-resources/src/components/MembersPresenter.svelte': { kind: 'notForGuests', reason: 'space membership' },
  'contact-resources/src/components/MergePersons.svelte': { kind: 'notForGuests', reason: 'administration' },
  'contact-resources/src/components/OrganizationEditor.svelte': { kind: 'notForGuests', reason: 'CRM' },
  'contact-resources/src/components/SelectAvatars.svelte': { kind: 'ambient' },
  'contact-resources/src/components/SpaceMembersEditor.svelte': { kind: 'notForGuests', reason: 'space membership' },
  'contact-resources/src/components/space/SpaceSettingsForm.svelte': { kind: 'notForGuests', reason: 'space settings' },

  // Objects with a known space/object
  'card-resources/src/components/CreateCardPopupFull.svelte': { kind: 'forwards' },
  'chunter-resources/src/components/discussions/CreateDiscussion.svelte': { kind: 'forwards' },
  'chunter-resources/src/components/discussions/DiscussionHeader.svelte': { kind: 'forwards' },
  'controlled-documents-resources/src/components/document/EditDocRelease.svelte': { kind: 'forwards' },
  'controlled-documents-resources/src/components/document/popups/ChangeOwnerPopup.svelte': { kind: 'forwards' },
  'notification-resources/src/components/CollaboratorEditor.svelte': { kind: 'forwards' },
  'text-editor-resources/src/components/MentionList.svelte': { kind: 'forwards' },
  'text-editor-resources/src/components/extension/todo/ToDoItemNodeView.svelte': { kind: 'forwards' },
  'tracker-resources/src/components/issues/AssigneeEditor.svelte': { kind: 'forwards' },
  'training-resources/src/components/TrainingRequestTraineesEditor.svelte': { kind: 'forwards' },

  // Attribute editors
  'training-resources/src/components/EmployeeEditor.svelte': { kind: 'editor' },
  'view-resources/src/components/PersonArrayEditor.svelte': { kind: 'editor' },

  // Not tied to an object
  'chunter-resources/src/components/chat/ChannelAside.svelte': { kind: 'optOut', reason: 'channel members' },
  'chunter-resources/src/components/chat/create/CreateDirectChat.svelte': { kind: 'optOut', reason: 'direct messages' },
  'love-resources/src/components/meeting/invites/InviteEmployeeButton.svelte': {
    kind: 'optOut',
    reason: 'meeting invites'
  },

  // Inside object views
  'attachment-resources/src/components/FileBrowserFilters.svelte': { kind: 'ambient' },
  'board-resources/src/components/KanbanCard.svelte': { kind: 'ambient' },
  'board-resources/src/components/TableView.svelte': { kind: 'ambient' },
  'board-resources/src/components/UserBoxList.svelte': { kind: 'ambient' },
  'calendar-resources/src/components/CreateReminder.svelte': { kind: 'ambient' },
  'controlled-documents-resources/src/components/TeamPopup.svelte': { kind: 'ambient' },
  'controlled-documents-resources/src/components/document/DocTeam.svelte': { kind: 'ambient' },
  'task-resources/src/components/AssigneePresenter.svelte': { kind: 'ambient' },
  'task-resources/src/components/TaskHeader.svelte': { kind: 'ambient' },
  'test-management-resources/src/components/test-plan/NewTestPlanAside.svelte': { kind: 'ambient' },
  'test-management-resources/src/components/test-run/NewTestRunAside.svelte': { kind: 'ambient' },
  'tracker-resources/src/components/components/LeadPresenter.svelte': { kind: 'ambient' },
  'tracker-resources/src/components/components/NewComponent.svelte': { kind: 'ambient' },
  'tracker-resources/src/components/issues/edit/ControlPanel.svelte': { kind: 'ambient' },
  'tracker-resources/src/components/issues/timereport/EstimationSubIssueList.svelte': { kind: 'ambient' },
  'tracker-resources/src/components/issues/timereport/TimeSpendReportPopup.svelte': { kind: 'ambient' },
  'tracker-resources/src/components/issues/timereport/TimeSpendReportsList.svelte': { kind: 'ambient' },
  'training-resources/src/components/TrainingAttemptPresenter.svelte': { kind: 'ambient' },

  // Not available to guests
  'gmail-resources/src/components/Configure.svelte': { kind: 'notForGuests', reason: 'integrations' },
  'gmail-resources/src/components/IntegrationSelector.svelte': { kind: 'notForGuests', reason: 'integrations' },
  'hr-resources/src/components/CreateDepartment.svelte': { kind: 'notForGuests', reason: 'HR' },
  'hr-resources/src/components/CreateRequest.svelte': { kind: 'notForGuests', reason: 'HR' },
  'hr-resources/src/components/DepartmentCard.svelte': { kind: 'notForGuests', reason: 'HR' },
  'hr-resources/src/components/DepartmentStaff.svelte': { kind: 'notForGuests', reason: 'HR' },
  'hr-resources/src/components/Members.svelte': { kind: 'notForGuests', reason: 'HR' },
  'lead-resources/src/components/CreateFunnel.svelte': { kind: 'notForGuests', reason: 'CRM' },
  'lead-resources/src/components/CreateLead.svelte': { kind: 'notForGuests', reason: 'CRM' },
  'lead-resources/src/components/EditLead.svelte': { kind: 'notForGuests', reason: 'CRM' },
  'love-resources/src/components/RoomConfigure.svelte': { kind: 'notForGuests', reason: 'office configuration' },
  'products-resources/src/components/product/CreateProduct.svelte': { kind: 'notForGuests', reason: 'space creation' },
  'recruit-resources/src/components/CreateApplication.svelte': { kind: 'notForGuests', reason: 'recruiting' },
  'recruit-resources/src/components/CreateVacancy.svelte': { kind: 'notForGuests', reason: 'recruiting' },
  'recruit-resources/src/components/review/CreateReview.svelte': { kind: 'notForGuests', reason: 'recruiting' },
  'recruit-resources/src/components/review/EditReview.svelte': { kind: 'notForGuests', reason: 'recruiting' },
  'setting-resources/src/components/Spaces.svelte': { kind: 'notForGuests', reason: 'settings' },
  'setting-resources/src/components/WorkspacePermissionEditor.svelte': { kind: 'notForGuests', reason: 'settings' },
  'setting-resources/src/components/access/SpacesAccessSettings.svelte': { kind: 'notForGuests', reason: 'settings' },
  'setting-resources/src/components/spaceTypes/editor/SpaceTypeGeneralSectionEditor.svelte': {
    kind: 'notForGuests',
    reason: 'settings'
  },
  'setting-resources/src/components/typeEditors/RoleAssignmentEditor.svelte': {
    kind: 'notForGuests',
    reason: 'settings'
  },
  'test-management-resources/src/components/project/CreateProject.svelte': {
    kind: 'notForGuests',
    reason: 'space creation'
  },
  'tracker-resources/src/components/projects/CreateProject.svelte': { kind: 'notForGuests', reason: 'space creation' },
  'tracker-resources/src/components/projects/MembersArrayEditor.svelte': {
    kind: 'notForGuests',
    reason: 'space membership'
  },
  'training-resources/src/components/Settings.svelte': { kind: 'notForGuests', reason: 'settings' },

  'training-resources/src/plugin.ts': { kind: 'declaration' }
}

const CHECKS: Partial<Record<Kind, RegExp>> = {
  forwards: /peopleScope/,
  editor: /\bobject\b|\.\.\.rest\b/,
  optOut: /peopleScope(: |=\{)null/
}

function listSources (dir: string, result: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === 'lib' || name === 'types') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      listSources(path, result)
    } else if (name.endsWith('.svelte') || name.endsWith('.ts')) {
      result.push(path)
    }
  }
  return result
}

function findPickerUsages (): Map<string, string> {
  const names = PICKERS.join('|')
  const usage = new RegExp(`<(?:${names})[\\s/>]|component\\.(?:${names})\\b|showPopup\\(\\s*(?:${names})\\b`)
  const result = new Map<string, string>()
  for (const plugin of readdirSync(PLUGINS_DIR)) {
    const src = join(PLUGINS_DIR, plugin, 'src')
    try {
      if (!statSync(src).isDirectory()) continue
    } catch {
      continue
    }
    for (const file of listSources(src)) {
      const content = readFileSync(file, 'utf-8')
      if (usage.test(content)) result.set(relative(PLUGINS_DIR, file).split(sep).join('/'), content)
    }
  }
  return result
}

describe('guest people scope inventory', () => {
  const usages = findPickerUsages()

  it('finds person pickers', () => {
    expect(usages.size).toBeGreaterThan(50)
  })

  it('every chokepoint narrows people for guests', () => {
    for (const [file, pattern] of Object.entries(CHOKEPOINTS)) {
      const content = readFileSync(join(PLUGINS_DIR, file), 'utf-8')
      expect({ file, narrows: pattern.test(content) }).toEqual({ file, narrows: true })
    }
  })

  it('every usage of a person picker is classified', () => {
    const unclassified = Array.from(usages.keys())
      .filter((file) => INVENTORY[file] === undefined && CHOKEPOINTS[file] === undefined)
      .sort()
    expect(unclassified).toEqual([])
  })

  it('every classified file still uses a person picker', () => {
    const stale = Object.keys(INVENTORY)
      .filter((file) => !usages.has(file))
      .sort()
    expect(stale).toEqual([])
  })

  it('classified files pass the scope as declared', () => {
    const mismatched = Object.entries(INVENTORY)
      .filter(([file, { kind }]) => {
        const check = CHECKS[kind]
        const content = usages.get(file)
        return check !== undefined && content !== undefined && !check.test(content)
      })
      .map(([file, { kind }]) => `${file}: ${kind}`)
    expect(mismatched).toEqual([])
  })
})
