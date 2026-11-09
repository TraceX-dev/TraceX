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

import { Mark, mergeAttributes } from '@tiptap/core'

/** The persisted attribute and mark name used by QMS comment anchors. */
export const qmsInlineCommentMarkName = 'node-uuid'

/** Options shared by server serialization and client rendering. */
export interface QMSInlineCommentMarkOptions {
  HTMLAttributes: Record<string, unknown>
}

/**
 * @public
 */
export const QMSInlineCommentMark = Mark.create<QMSInlineCommentMarkOptions>({
  name: qmsInlineCommentMarkName,
  exitable: true,
  inclusive: false,
  excludes: '',

  addOptions () {
    return { HTMLAttributes: {} }
  },

  addAttributes () {
    return {
      [qmsInlineCommentMarkName]: {
        default: null,
        parseHTML: (element) => element.getAttribute(qmsInlineCommentMarkName)
      }
    }
  },

  parseHTML () {
    return [
      {
        tag: `span[${qmsInlineCommentMarkName}]`,
        getAttrs: (element) => {
          const value = element.getAttribute(qmsInlineCommentMarkName)?.trim()
          return value === undefined || value.length === 0 ? false : null
        }
      }
    ]
  },

  renderHTML ({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  }
})
