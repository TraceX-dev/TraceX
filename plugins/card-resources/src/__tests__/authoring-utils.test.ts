// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { compileProcessYaml } from '@hcengineering/process'
import { newDefinitionYaml } from '../authoring-utils'

describe('YAML editor starter definitions', () => {
  it('creates a named card module with a field belonging to its card type', () => {
    const source = newDefinitionYaml('card')
    const compiled = compileProcessYaml(source)
    expect(compiled.kind).toBe('card')
    expect(compiled.version).toBe(2)
    expect(source).toContain('cardTypes:')
    expect(compiled.docs.find((doc) => doc._class === 'core:class:Attribute')).toEqual(
      expect.objectContaining({
        attributeOf: 'new_card',
        name: 'summary',
        label: 'embedded:embedded:Summary',
        isCustom: true
      })
    )
  })

  it('creates a named standalone process with a valid starting transition', () => {
    const compiled = compileProcessYaml(newDefinitionYaml('process'))
    expect(compiled.kind).toBe('process')
    expect(compiled.version).toBe(2)
    expect(compiled.docs.find((doc) => doc.from === null)).toEqual(
      expect.objectContaining({
        trigger: 'process:trigger:OnExecutionStart',
        to: 'done'
      })
    )
    expect(compiled.docs).toHaveLength(3)
  })
})
