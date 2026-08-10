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

import { FontFamily } from '../fontFamily'

// See the comment at the top of cellAlign.test.ts for why this calls the extension's config
// functions directly instead of going through a real tiptap `Editor` (no DOM in this package's
// test environment).
//
// setFontFamily/unsetFontFamily are plain setMark/unsetMark calls - the reason that is enough to
// also cover a multi-cell CellSelection (and not just a single-cell TextSelection) is that
// `@tiptap/core`'s setMark/unsetMark iterate `selection.ranges`, and `prosemirror-tables`'
// CellSelection populates `ranges` with one range per selected cell (verified against the
// installed prosemirror-tables@1.8.1 source: `CellSelection` passes a `cells.map(...)` ranges
// array to the `Selection` constructor). A `TextSelection`'s `ranges` is just `[{ $from, $to }]`,
// so the exact same command works for both without any special-casing.

function defined<T> (value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected value to be defined')
  }
  return value
}

function getAttributes (): Record<string, any> {
  const [{ attributes }] = defined(FontFamily.config.addGlobalAttributes).call({
    options: { types: ['textStyle'] }
  } as any)
  return attributes
}

function getCommands (): Record<string, (...args: any[]) => any> {
  return defined(FontFamily.config.addCommands).call({} as any) as any
}

describe('FontFamily attributes', () => {
  it('renders fontFamily as an inline style + data attribute', () => {
    const { fontFamily } = getAttributes()
    expect(fontFamily.renderHTML({ fontFamily: 'Georgia, serif' })).toEqual({
      'data-font-family': 'Georgia, serif',
      style: 'font-family: Georgia, serif'
    })
  })

  it('renders nothing when fontFamily is not set', () => {
    const { fontFamily } = getAttributes()
    expect(fontFamily.renderHTML({ fontFamily: null })).toEqual({})
  })

  it('parses fontFamily from an inline style, stripping quotes', () => {
    const { fontFamily } = getAttributes()
    expect(fontFamily.parseHTML({ style: { fontFamily: '"Times New Roman", serif' } })).toBe('Times New Roman, serif')
    expect(fontFamily.parseHTML({ style: { fontFamily: '' } })).toBe(null)
  })
})

describe('FontFamily commands', () => {
  it('setFontFamily delegates to chain().setMark(textStyle, { fontFamily })', () => {
    const commands = getCommands()
    const run = jest.fn(() => true)
    const chainable = { setMark: jest.fn(), run }
    chainable.setMark.mockReturnValue(chainable)
    const chain = jest.fn(() => chainable)

    const result = defined(commands.setFontFamily)('Inter, sans-serif')({ chain } as any)

    expect(chain).toHaveBeenCalled()
    expect(chainable.setMark).toHaveBeenCalledWith('textStyle', { fontFamily: 'Inter, sans-serif' })
    expect(run).toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('unsetFontFamily delegates to chain().unsetMark(textStyle)', () => {
    const commands = getCommands()
    const run = jest.fn(() => true)
    const chainable = { unsetMark: jest.fn(), run }
    chainable.unsetMark.mockReturnValue(chainable)
    const chain = jest.fn(() => chainable)

    const result = defined(commands.unsetFontFamily)()({ chain } as any)

    expect(chainable.unsetMark).toHaveBeenCalledWith('textStyle')
    expect(run).toHaveBeenCalled()
    expect(result).toBe(true)
  })
})
