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

import type { Mark, Node as PMNode } from '@tiptap/pm/model'
import { AgentOperationFailure } from './schema'

export interface AgentTextSpan {
  from: number
  to: number
  marks: readonly Mark[]
}

export interface AgentTextMatch {
  from: number
  to: number
  spans: AgentTextSpan[]
}

/** Literal, non-overlapping matches across mark boundaries, but never across blocks or inline objects. */
export function findAgentText (node: PMNode, contentStart: number, search: string): AgentTextMatch[] {
  if (search.length === 0) throw new AgentOperationFailure('INVALID_OPERATION', 'search must not be empty.')
  const matches: AgentTextMatch[] = []
  const textblock = (block: PMNode, start: number): void => {
    let text = ''
    let spans: AgentTextSpan[] = []
    const flush = (): void => {
      let index = text.indexOf(search)
      const first = spans[0]
      if (first !== undefined) {
        while (index !== -1) {
          const from = first.from + index
          const to = from + search.length
          matches.push({ from, to, spans: spans.filter((span) => span.from < to && span.to > from) })
          index = text.indexOf(search, index + search.length)
        }
      }
      text = ''
      spans = []
    }
    block.forEach((child, offset) => {
      if (!child.isText) {
        flush()
        return
      }
      text += child.text ?? ''
      spans.push({ from: start + offset, to: start + offset + child.nodeSize, marks: child.marks })
    })
    flush()
  }
  if (node.isTextblock) textblock(node, contentStart)
  else {
    node.descendants((child, offset) => {
      if (child.isTextblock) {
        textblock(child, contentStart + offset + 1)
        return false
      }
      return !child.isAtom
    })
  }
  return matches
}
