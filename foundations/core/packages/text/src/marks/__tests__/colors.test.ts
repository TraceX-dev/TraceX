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

import { BackgroundColor, TextColor } from '../colors'

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
  it('unsetTextColor delegates to chain().unsetMark(textStyle)', () => {
    // color is the only attribute textStyle carries, so removing the whole mark is safe.
    const commands = getCommands()
    const run = jest.fn(() => true)
    const chainable = { unsetMark: jest.fn(), run }
    chainable.unsetMark.mockReturnValue(chainable)
    const chain = jest.fn(() => chainable)

    const result = defined(commands.unsetTextColor)()({ chain } as any)

    expect(chainable.unsetMark).toHaveBeenCalledWith('textStyle')
    expect(run).toHaveBeenCalled()
    expect(result).toBe(true)
  })
})

function getBackgroundColorAttributes (types: string[] = ['tableCell']): Record<string, any> {
  const [{ attributes }] = defined(BackgroundColor.config.addGlobalAttributes).call({ options: { types } } as any)
  return attributes
}

function getBackgroundColorCommands (types: string[] = ['tableCell']): Record<string, (...args: any[]) => any> {
  return defined(BackgroundColor.config.addCommands).call({ options: { types } } as any) as any
}

function commandsStub (): { updateAttributes: jest.Mock, resetAttributes: jest.Mock } {
  return {
    updateAttributes: jest.fn(() => true),
    resetAttributes: jest.fn(() => true)
  }
}

describe('BackgroundColor attributes', () => {
  it('renders backgroundColor as an inline style + data attribute', () => {
    const { backgroundColor } = getBackgroundColorAttributes()
    expect(backgroundColor.renderHTML({ backgroundColor: '#ff0000' })).toEqual({
      'data-background-color': '#ff0000',
      style: 'background-color: #ff0000'
    })
  })

  it('renders nothing when backgroundColor is not a string', () => {
    const { backgroundColor } = getBackgroundColorAttributes()
    expect(backgroundColor.renderHTML({})).toEqual({})
    expect(backgroundColor.renderHTML({ backgroundColor: null })).toEqual({})
  })

  it('parses backgroundColor from the data attribute', () => {
    const { backgroundColor } = getBackgroundColorAttributes()
    expect(backgroundColor.parseHTML({ getAttribute: () => '#00ff00' })).toBe('#00ff00')
    expect(backgroundColor.parseHTML({ getAttribute: () => null })).toBe(undefined)
  })
})

describe('BackgroundColor commands', () => {
  // Regression coverage for the bug where table header cells were stuck grey and uneditable:
  // `common-kit.ts` used to configure this extension for `tableCell` only, so `setBackgroundColor`
  // silently no-op'd on `tableHeader` nodes (see kits/__tests__/common-kit.test.ts for the check
  // that the real production kit now configures both types).
  it('setBackgroundColor updates every configured node type, including tableHeader', () => {
    const commands = getBackgroundColorCommands(['tableCell', 'tableHeader'])
    const stub = commandsStub()

    const result = defined(commands.setBackgroundColor)('#ff0000')({ commands: stub } as any)

    expect(result).toBe(true)
    expect(stub.updateAttributes).toHaveBeenCalledWith('tableCell', { backgroundColor: '#ff0000' })
    expect(stub.updateAttributes).toHaveBeenCalledWith('tableHeader', { backgroundColor: '#ff0000' })
  })

  it('unsetBackgroundColor resets the attribute on every configured node type', () => {
    const commands = getBackgroundColorCommands(['tableCell', 'tableHeader'])
    const stub = commandsStub()

    const result = defined(commands.unsetBackgroundColor)()({ commands: stub } as any)

    expect(result).toBe(true)
    expect(stub.resetAttributes).toHaveBeenCalledWith('tableCell', 'backgroundColor')
    expect(stub.resetAttributes).toHaveBeenCalledWith('tableHeader', 'backgroundColor')
  })

  it('fails if updating any configured type fails', () => {
    const commands = getBackgroundColorCommands(['tableCell', 'tableHeader'])
    const stub = commandsStub()
    stub.updateAttributes.mockReturnValueOnce(true).mockReturnValueOnce(false)

    const result = defined(commands.setBackgroundColor)('#ff0000')({ commands: stub } as any)

    expect(result).toBe(false)
  })
})
