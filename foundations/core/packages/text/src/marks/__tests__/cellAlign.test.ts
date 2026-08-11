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

import { CellAlign } from '../cellAlign'

// This package's jest config runs in a Node (non-jsdom) environment, so a real tiptap `Editor`
// cannot be instantiated here (its view layer requires `document`). We instead call the
// extension's `addGlobalAttributes`/`addCommands` config functions directly (the same functions
// tiptap invokes internally), which is enough to exercise the actual attribute serialization and
// command-composition logic without a DOM.
//
// The claim that `commands.updateAttributes`/`resetAttributes` apply to every cell of a multi-cell
// `CellSelection` (not just the anchor cell) is a property of `@tiptap/core` + `prosemirror-tables`
// themselves (both iterate `selection.ranges`, and `CellSelection` provides one range per selected
// cell) - the same mechanism already used in production by the pre-existing `BackgroundColor`
// extension this one is modeled after.

function defined<T> (value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected value to be defined')
  }
  return value
}

function getAttributes (types: string[] = ['tableCell']): Record<string, any> {
  const [{ attributes }] = defined(CellAlign.config.addGlobalAttributes).call({ options: { types } } as any)
  return attributes
}

function getCommands (
  types: string[] = ['tableCell'],
  blockTypes: string[] = ['paragraph', 'heading']
): Record<string, (...args: any[]) => any> {
  return defined(CellAlign.config.addCommands).call({ options: { types, blockTypes } } as any) as any
}

function commandsStub (): { updateAttributes: jest.Mock, resetAttributes: jest.Mock } {
  return {
    updateAttributes: jest.fn(() => true),
    resetAttributes: jest.fn(() => true)
  }
}

describe('CellAlign attributes', () => {
  it('renders textAlign as an inline style + data attribute', () => {
    const { textAlign } = getAttributes()
    expect(textAlign.renderHTML({ textAlign: 'center' })).toEqual({
      'data-text-align': 'center',
      style: 'text-align: center'
    })
  })

  it('renders nothing when textAlign is not set', () => {
    const { textAlign } = getAttributes()
    expect(textAlign.renderHTML({ textAlign: null })).toEqual({})
  })

  it('parses textAlign from an inline style, falling back to the data attribute', () => {
    const { textAlign } = getAttributes()
    expect(textAlign.parseHTML({ style: { textAlign: 'right' }, getAttribute: () => null })).toBe('right')
    expect(textAlign.parseHTML({ style: { textAlign: '' }, getAttribute: () => 'left' })).toBe('left')
    expect(textAlign.parseHTML({ style: { textAlign: '' }, getAttribute: () => null })).toBe(null)
  })

  it('renders/parses verticalAlign the same way', () => {
    const { verticalAlign } = getAttributes()
    expect(verticalAlign.renderHTML({ verticalAlign: 'middle' })).toEqual({
      'data-vertical-align': 'middle',
      style: 'vertical-align: middle'
    })
    expect(verticalAlign.renderHTML({ verticalAlign: null })).toEqual({})
    expect(verticalAlign.parseHTML({ style: { verticalAlign: 'bottom' }, getAttribute: () => null })).toBe('bottom')
  })
})

describe('CellAlign commands', () => {
  it('setCellTextAlign updates every configured node type', () => {
    const commands = getCommands(['tableCell', 'tableHeader'])
    const stub = commandsStub()

    const result = defined(commands.setCellTextAlign)('center')({ commands: stub } as any)

    expect(result).toBe(true)
    expect(stub.updateAttributes).toHaveBeenCalledWith('tableCell', { textAlign: 'center' })
    expect(stub.updateAttributes).toHaveBeenCalledWith('tableHeader', { textAlign: 'center' })
  })

  it('setCellTextAlign clears a paragraph/heading own text-align so the cell-level one is not shadowed', () => {
    // A paragraph's own `text-align` (set by the separate paragraph-level TextAlign extension)
    // takes CSS precedence over the inherited cell-level one, so without this the cell alignment
    // would silently appear to do nothing whenever a paragraph inside the cell was aligned before.
    const commands = getCommands(['tableCell'])
    const stub = commandsStub()

    defined(commands.setCellTextAlign)('center')({ commands: stub } as any)

    expect(stub.resetAttributes).toHaveBeenCalledWith('paragraph', 'textAlign')
    expect(stub.resetAttributes).toHaveBeenCalledWith('heading', 'textAlign')
  })

  it('setCellTextAlign still reports success even without paragraph/heading node types in the schema', () => {
    const commands = getCommands(['tableCell'])
    const stub = commandsStub()
    stub.resetAttributes.mockReturnValue(false)

    const result = defined(commands.setCellTextAlign)('center')({ commands: stub } as any)

    expect(result).toBe(true)
  })

  it('unsetCellTextAlign resets the attribute on every configured node type', () => {
    const commands = getCommands(['tableCell'])
    const stub = commandsStub()

    const result = defined(commands.unsetCellTextAlign)()({ commands: stub } as any)

    expect(result).toBe(true)
    expect(stub.resetAttributes).toHaveBeenCalledWith('tableCell', 'textAlign')
  })

  it('setCellVerticalAlign / unsetCellVerticalAlign mirror the horizontal ones', () => {
    const commands = getCommands(['tableCell'])
    const stub = commandsStub()

    defined(commands.setCellVerticalAlign)('bottom')({ commands: stub } as any)
    expect(stub.updateAttributes).toHaveBeenCalledWith('tableCell', { verticalAlign: 'bottom' })

    defined(commands.unsetCellVerticalAlign)()({ commands: stub } as any)
    expect(stub.resetAttributes).toHaveBeenCalledWith('tableCell', 'verticalAlign')
  })

  it('fails if updating any configured type fails', () => {
    const commands = getCommands(['tableCell', 'tableHeader'])
    const stub = commandsStub()
    stub.updateAttributes.mockReturnValueOnce(true).mockReturnValueOnce(false)

    const result = defined(commands.setCellTextAlign)('left')({ commands: stub } as any)

    expect(result).toBe(false)
  })
})
