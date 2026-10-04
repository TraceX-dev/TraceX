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

import core, { type Type } from '@hcengineering/core'
import { isRequiredValueFilled } from '../required-value'

describe('required workflow values', () => {
  test.each([undefined, null, [], '', ' ', '\t\n'])('rejects empty input %p', (value) => {
    expect(isRequiredValueFilled(value)).toBe(false)
  })

  test.each([false, true, 0, 1, 'selected-card', ['selected-card'], ' answer '])(
    'accepts a filled input %p',
    (value) => {
      expect(isRequiredValueFilled(value)).toBe(true)
    }
  )

  const markupType: Type<string> = { _class: core.class.TypeMarkup, label: core.string.Markup }

  test.each([
    { type: 'doc', content: [] },
    { type: 'doc', content: [{ type: 'paragraph' }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] }
  ])('rejects empty rich text %p', (value) => {
    expect(isRequiredValueFilled(JSON.stringify(value), markupType)).toBe(false)
  })

  test.each([
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Output' }] }] },
    { type: 'doc', content: [{ type: 'image', attrs: { src: 'image.png' } }] }
  ])('accepts rich text content %p', (value) => {
    expect(isRequiredValueFilled(JSON.stringify(value), markupType)).toBe(true)
  })
})
