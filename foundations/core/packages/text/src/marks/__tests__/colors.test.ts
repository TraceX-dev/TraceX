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

import { TextColor } from '../colors'

// See the comment at the top of cellAlign.test.ts for why this calls the extension's config
// functions directly instead of going through a real tiptap `Editor` (no DOM in this package's
// test environment).

function defined<T> (value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected value to be defined')
  }
  return value
}

function getCommands (): Record<string, (...args: any[]) => any> {
  return defined(TextColor.config.addCommands).call({} as any) as any
}

describe('TextColor commands', () => {
  it('unsetTextColor nulls just the color attribute and cleans up the empty mark', () => {
    // Must not use unsetMark('textStyle') - that would also wipe out a co-existing font family
    // (see FontFamily in fontFamily.ts, which lives on the same `textStyle` mark).
    const commands = getCommands()
    const run = jest.fn(() => true)
    const chainable = { setMark: jest.fn(), removeEmptyTextStyle: jest.fn(), run }
    chainable.setMark.mockReturnValue(chainable)
    chainable.removeEmptyTextStyle.mockReturnValue(chainable)
    const chain = jest.fn(() => chainable)

    const result = defined(commands.unsetTextColor)()({ chain } as any)

    expect(chainable.setMark).toHaveBeenCalledWith('textStyle', { color: null })
    expect(chainable.removeEmptyTextStyle).toHaveBeenCalled()
    expect(run).toHaveBeenCalled()
    expect(result).toBe(true)
  })
})
