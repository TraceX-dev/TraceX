//
// Copyright © 2025 Hardcore Engineering Inc.
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

import core, { AccountRole, type ClassPermission, type Ref } from '@hcengineering/core'
import process from '.'
import { type Builder } from '@hcengineering/model'
import { ExecutionStatus } from '@hcengineering/process'

export function definePermissions (builder: Builder): void {
  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: process.string.RunProcessPermission,
      txClass: core.class.TxCreateDoc,
      objectClass: process.class.Execution,
      scope: 'space'
    },
    process.permission.RunProcess
  )

  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: process.string.CancelProcessPermission,
      txClass: core.class.TxUpdateDoc,
      objectClass: process.class.Execution,
      txMatch: {
        'operations.status': ExecutionStatus.Cancelled
      },
      scope: 'space'
    },
    process.permission.CancelProcess
  )

  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: process.string.ForbidRunProcessPermission,
      txClass: core.class.TxCreateDoc,
      objectClass: process.class.Execution,
      scope: 'space',
      forbid: true
    },
    process.permission.ForbidRunProcess
  )

  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: process.string.ForbidCancelProcessPermission,
      txClass: core.class.TxUpdateDoc,
      objectClass: process.class.Execution,
      txMatch: {
        'operations.status': ExecutionStatus.Cancelled
      },
      scope: 'space',
      forbid: true
    },
    process.permission.ForbidCancelProcess
  )

  defineGuestPermissions(builder)
}

/**
 * Guests take part in processes of the cards they can read: they complete the process tasks and
 * approval requests assigned to them, and start the auto-start processes of the cards they create, so they can
 * provide the input those processes ask for. Otherwise starting or cancelling processes is not available to guests.
 */
function defineGuestPermissions (builder: Builder): void {
  builder.createDoc<ClassPermission>(
    core.class.ClassPermission,
    core.space.Model,
    {
      label: process.string.GuestParticipatePermission,
      // Activates the process guest validator, which lets guests start processes of the cards they create.
      application: process.app.Process,
      // ApproveRequest is derived from ProcessToDo, so both are covered.
      targetClass: process.class.ProcessToDo,
      guestAssignee: {
        field: 'user',
        attributes: ['doneOn', 'approved', 'reason'],
        openField: 'doneOn',
        requireAttachedToAccess: true
      }
    },
    process.permission.GuestParticipate as Ref<ClassPermission>
  )

  // No space class: process tasks live in the shared todo space, access is checked through the card.
  builder.createDoc(
    core.class.ModulePermissionGroup,
    core.space.Model,
    {
      application: process.app.Process,
      role: AccountRole.Guest,
      permissions: [process.permission.GuestParticipate],
      enabled: true
    },
    process.ids.ModulePermissionGroup
  )
}
