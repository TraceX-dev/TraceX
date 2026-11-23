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

import { toPrefixFulltextQuery } from '../fulltextQuery'

describe('toPrefixFulltextQuery', () => {
  it('adds a prefix wildcard to a single term', () => {
    expect(toPrefixFulltextQuery('def')).toBe('def*')
  })

  it('adds a prefix wildcard to every term', () => {
    expect(toPrefixFulltextQuery('  abc   def ')).toBe('abc* def*')
  })

  it('keeps full codes and adds a wildcard to them', () => {
    expect(toPrefixFulltextQuery('ABC_DEFGH-12')).toBe('ABC_DEFGH-12*')
  })

  it('leaves one-character terms unchanged', () => {
    expect(toPrefixFulltextQuery('a')).toBe('a')
    expect(toPrefixFulltextQuery('v 1 def')).toBe('v 1 def*')
  })

  it('returns an empty string for blank input', () => {
    expect(toPrefixFulltextQuery('')).toBe('')
    expect(toPrefixFulltextQuery('   ')).toBe('')
  })

  it('does not touch explicit query syntax', () => {
    expect(toPrefixFulltextQuery('"exact phrase"')).toBe('"exact phrase"')
    expect(toPrefixFulltextQuery('def*')).toBe('def*')
    expect(toPrefixFulltextQuery('defgh~1')).toBe('defgh~1')
    expect(toPrefixFulltextQuery('a | b')).toBe('a | b')
    expect(toPrefixFulltextQuery('def -draft')).toBe('def -draft')
  })
})
