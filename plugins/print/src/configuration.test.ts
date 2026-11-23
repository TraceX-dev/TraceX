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

import core, { type Class, type Doc, type Hierarchy, type Ref } from '@hcengineering/core'
import { selectPrintConfiguration } from './configuration'
import type { PrintConfiguration } from './types'

const base = 'test:class:Card' as Ref<Class<Doc>>
const derived = 'test:class:Request' as Ref<Class<Doc>>
const hierarchy: Partial<Hierarchy> = { getAncestors: jest.fn().mockReturnValue([derived, base, core.class.Doc]) }

function config (targetClass: Ref<Class<Doc>>, enabled = true): PrintConfiguration {
  const value: Partial<PrintConfiguration> = { targetClass, enabled, header: 'Title', footer: '', printLogo: true }
  return value as PrintConfiguration
}

it('inherits the base Card configuration for concrete card types', () => {
  const value = config(base)
  expect(selectPrintConfiguration(hierarchy as Hierarchy, derived, [value])).toBe(value)
})

it('prefers the nearest class independently of configuration list order', () => {
  const parent = config(base)
  const specific = config(derived)
  expect(selectPrintConfiguration(hierarchy as Hierarchy, derived, [parent, specific])).toBe(specific)
  expect(selectPrintConfiguration(hierarchy as Hierarchy, derived, [specific, parent])).toBe(specific)
})

it('keeps a disabled override instead of falling back to an enabled ancestor', () => {
  const parent = config(base)
  const disabled = config(derived, false)
  expect(selectPrintConfiguration(hierarchy as Hierarchy, derived, [parent, disabled])).toBe(disabled)
})

it('does not choose an unrelated configuration', () => {
  const unrelated = config('test:class:ControlledDocument' as Ref<Class<Doc>>)
  expect(selectPrintConfiguration(hierarchy as Hierarchy, derived, [unrelated])).toBeUndefined()
})
