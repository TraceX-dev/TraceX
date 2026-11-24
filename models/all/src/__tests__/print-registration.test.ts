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

import type { Class, Doc, Ref } from '@hcengineering/core'
import print from '@hcengineering/model-print'
import buildModel from '../index'

jest.mock('@hcengineering/model-print', () => jest.requireActual('../../../print/src'))
jest.mock('@hcengineering/model-card', () => jest.requireActual('../../../card/src'))
jest.mock('@hcengineering/model-controlled-documents', () => jest.requireActual('../../../controlled-documents/src'))

it('initializes the complete model with print providers on registered document classes', () => {
  const builder = buildModel()
  const targets: Array<{ target: Ref<Class<Doc>>, provider: string }> = [
    { target: 'card:class:Card' as Ref<Class<Doc>>, provider: 'card:function:PrintData' },
    { target: 'documents:class:ControlledDocument' as Ref<Class<Doc>>, provider: 'documents:function:PrintData' }
  ]
  for (const { target, provider } of targets) {
    const capability = builder.hierarchy.classHierarchyMixin(target, print.mixin.PrintConfig)
    expect(capability?.provider).toBe(provider)
  }
})
