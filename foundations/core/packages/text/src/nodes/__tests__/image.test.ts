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

import { getInlineImageContainerStyle } from '../image'

describe('getInlineImageContainerStyle', () => {
  it('returns nothing for a block image', () => {
    expect(getInlineImageContainerStyle({ width: '25%' })).toBeUndefined()
    expect(getInlineImageContainerStyle({ display: null, width: 100 })).toBeUndefined()
  })

  it('returns nothing without a width', () => {
    expect(getInlineImageContainerStyle({ display: 'inline' })).toBeUndefined()
    expect(getInlineImageContainerStyle({ display: 'inline', width: null })).toBeUndefined()
  })

  it('keeps percentages and px, treats a bare number as px', () => {
    expect(getInlineImageContainerStyle({ display: 'inline', width: '25%' })).toBe('width: 25%')
    expect(getInlineImageContainerStyle({ display: 'inline', width: '50.5%' })).toBe('width: 50.5%')
    expect(getInlineImageContainerStyle({ display: 'inline', width: '320px' })).toBe('width: 320px')
    expect(getInlineImageContainerStyle({ display: 'inline', width: 320 })).toBe('width: 320px')
    expect(getInlineImageContainerStyle({ display: 'inline', width: '320' })).toBe('width: 320px')
  })

  it('ignores values that are not a plain size', () => {
    expect(getInlineImageContainerStyle({ display: 'inline', width: '1px; color: red' })).toBeUndefined()
    expect(getInlineImageContainerStyle({ display: 'inline', width: 'auto' })).toBeUndefined()
    expect(getInlineImageContainerStyle({ display: 'inline', width: '' })).toBeUndefined()
  })
})
