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

import core from '@hcengineering/core'
import { type Builder } from '@hcengineering/model'
import documents from '../plugin'
import { definePermissions } from '../permissions'
import { roles } from '../roles'

describe('controlled documents roles', () => {
  it.each([
    [documents.permission.CreateDocument, documents.class.ControlledDocument],
    [documents.permission.CreateDocumentCategory, documents.class.DocumentCategory]
  ])('keeps %s scoped to create transactions for %s', (permissionId, objectClass) => {
    const createDoc = jest.fn()
    definePermissions({ createDoc } as unknown as Builder)
    const permissionCall = createDoc.mock.calls.find(([, , , id]) => id === permissionId)

    expect(permissionCall?.[0]).toBe(core.class.ClassPermission)
    expect(permissionCall?.[2]).toMatchObject({
      txClass: core.class.TxCreateDoc,
      objectClass,
      targetClass: objectClass
    })
  })

  it.each([documents.role.Manager, documents.role.QARA])(
    'keeps document and category creation permissions for %s',
    (roleId) => {
      const role = roles.find(({ _id }) => _id === roleId)

      expect(role?.permissions).toEqual(
        expect.arrayContaining([
          documents.permission.CreateDocument,
          documents.permission.CreateDocumentCategory
        ])
      )
    }
  )

  it('does not broaden Qualified User creation permissions', () => {
    const role = roles.find(({ _id }) => _id === documents.role.QualifiedUser)

    expect(role?.permissions).not.toContain(documents.permission.CreateDocument)
    expect(role?.permissions).not.toContain(documents.permission.CreateDocumentCategory)
  })
})
