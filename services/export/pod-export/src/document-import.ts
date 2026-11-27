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

import { type MeasureContext } from '@hcengineering/core'
import { ApiError } from '@hcengineering/server-core'
import { jsonToPmNode, type MarkupNode } from '@hcengineering/text'

/**
 * Reject imported markup that does not fit the editor schema.
 *
 * The collaborator builds the Y.Doc from markup without schema validation, so such markup
 * would be stored as is and break the editor for everyone who opens the document.
 */
export function assertFitsEditorSchema (ctx: MeasureContext, markup: MarkupNode): void {
  try {
    jsonToPmNode(markup).check()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.warn('imported document does not fit the editor schema', { error: message })
    throw new ApiError(422, `Imported document does not fit the editor schema: ${message}`)
  }
}
