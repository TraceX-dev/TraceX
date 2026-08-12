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

import { type AnyExtension, getExtensionField } from '@tiptap/core'
import { TextColorStylingKit } from '../common-kit'

// Resolve the sub-extensions an `extensionKit` declares via `addExtensions`, the same way
// tiptap's own ExtensionManager would when the kit is loaded into an editor. This lets us assert
// on the *actual production wiring* without mounting a real (DOM-backed) editor — see
// marks/__tests__/colors.test.ts and cellAlign.test.ts for the generic behavior of the
// extensions themselves.
function resolveKitExtensions (kit: AnyExtension): AnyExtension[] {
  const addExtensions = getExtensionField<() => AnyExtension[]>(kit, 'addExtensions', {
    name: kit.name,
    options: kit.options,
    editor: undefined,
    parent: null
  })
  return addExtensions?.() ?? []
}

describe('TextColorStylingKit', () => {
  it('registers the backgroundColor attribute on both tableCell and tableHeader', () => {
    // Regression test: this used to be configured for `tableCell` only, so header-row cells
    // (tableHeader nodes) always fell back to the hardcoded grey CSS variable (prose.scss
    // `th { background-color: var(--text-editor-table-header-color) }`) with no way to override
    // it — the color picker's setBackgroundColor command silently no-op'd on that node type.
    const extensions = resolveKitExtensions(TextColorStylingKit)
    const backgroundColor = extensions.find((ext) => ext.name === 'backgroundColor')

    expect(backgroundColor).toBeDefined()
    expect(backgroundColor?.options.types).toEqual(expect.arrayContaining(['tableCell', 'tableHeader']))
  })
})
