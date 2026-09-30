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

import core from '@hcengineering/core'
import { type Builder } from '@hcengineering/model'
import { defineGuestCreatePolicies } from '../guestPolicies'
import { definePermissions } from '../permissions'
import documents from '../plugin'

function collectCreateDocCalls (define: (builder: Builder) => void): unknown[][] {
  const createDoc = jest.fn()
  define({ createDoc } as unknown as Builder)
  return createDoc.mock.calls
}

describe('controlled documents guest create policies', () => {
  it.each([
    [documents.ids.GuestCreateDocumentPolicy, documents.class.ControlledDocument],
    [documents.ids.GuestCreateDocumentCategoryPolicy, documents.class.DocumentCategory]
  ])('defines %s as a module policy without space permission matching', (policyId, targetClass) => {
    const call = collectCreateDocCalls(defineGuestCreatePolicies).find(([, , , id]) => id === policyId)

    expect(call?.[0]).toBe(core.class.ClassPermission)
    expect(call?.[2]).toMatchObject({ targetClass, application: documents.app.Documents })
    // txClass/objectClass would make SpacePermissionsMiddleware enforce the policy for every role.
    expect(call?.[2]).not.toHaveProperty('txClass')
    expect(call?.[2]).not.toHaveProperty('objectClass')
  })

  it.each([documents.permission.CreateDocument, documents.permission.CreateDocumentCategory])(
    'keeps the space permission %s a plain permission',
    (permissionId) => {
      const call = collectCreateDocCalls(definePermissions).find(([, , , id]) => id === permissionId)

      expect(call?.[0]).toBe(core.class.Permission)
      expect(call?.[2]).not.toHaveProperty('txClass')
    }
  )
})
