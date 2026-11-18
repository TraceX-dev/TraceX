// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import card from '@hcengineering/card'
import core from '@hcengineering/core'
import type { DefinitionPackageRelease } from '@hcengineering/marketplace'
import process, {
  type AuthoringNativeDocument,
  type Process,
  type State,
  type Transition
} from '@hcengineering/process'
import { jsonToMarkup, MarkupNodeType, type MarkupNode } from '@hcengineering/text-core'

export interface DraftCardPreview {
  definition: AuthoringNativeDocument
  fields: AuthoringNativeDocument[]
}

export interface DraftProcessPreview {
  definition: Process
  states: State[]
  transitions: Transition[]
}

export interface PackageDraftPreview {
  cards: DraftCardPreview[]
  processes: DraftProcessPreview[]
}

function compareRank (left: { rank: string }, right: { rank: string }): number {
  return left.rank === right.rank ? 0 : left.rank < right.rank ? -1 : 1
}

/** Groups compiled definitions in their authored display and branch priority order. */
export function createPackageDraftPreview (release: DefinitionPackageRelease): PackageDraftPreview {
  const documents = release.definition.docs
  return {
    cards: documents
      .filter((doc) => doc._class === card.class.MasterTag || doc._class === card.class.Tag)
      .map((definition) => ({
        definition,
        fields: documents.filter((doc) => doc._class === core.class.Attribute && doc.attributeOf === definition._id)
      })),
    processes: documents
      .filter((doc) => doc._class === process.class.Process)
      .map((definition) => {
        const states = documents.filter(
          (doc) => doc._class === process.class.State && doc.process === definition._id
        ) as unknown as State[]
        states.sort(compareRank)
        const order = new Map(states.map((state, index) => [state._id, index]))
        const transitions = documents.filter(
          (doc) => doc._class === process.class.Transition && doc.process === definition._id
        ) as unknown as Transition[]
        transitions.sort(
          (left, right) =>
            (left.from === null ? -1 : (order.get(left.from) ?? 0)) -
              (right.from === null ? -1 : (order.get(right.from) ?? 0)) || compareRank(left, right)
        )
        const preview: DraftProcessPreview = { definition: definition as unknown as Process, states, transitions }
        return preview
      })
  }
}

/** Creates a read-only code block using the shared presentation renderer. */
export function draftCodeMarkup (text: string, language: 'yaml' | 'mermaid'): string {
  const document: MarkupNode = {
    type: MarkupNodeType.doc,
    content: [{ type: MarkupNodeType.code_block, attrs: { language }, content: [{ type: MarkupNodeType.text, text }] }]
  }
  return jsonToMarkup(document)
}

function diagramLabel (value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[#"&<>\\]/g, (character) => `#${character.charCodeAt(0)};`)
}

/** Uses generated graph IDs so labels and storage identities cannot become Mermaid syntax. */
export function draftProcessDiagram (preview: DraftProcessPreview): string {
  const nodes = new Map(preview.states.map((state, index) => [String(state._id), `state${index}`]))
  const lines = ['flowchart TD']
  if (preview.transitions.some((transition) => transition.from === null)) lines.push('  start(("▶"))')
  for (const state of preview.states) {
    const terminal = !preview.transitions.some((transition) => transition.from === state._id)
    lines.push(
      `  ${nodes.get(state._id)}${terminal ? '(["' : '["'}${diagramLabel(state.title)}${terminal ? '"])' : '"]'}`
    )
  }
  preview.transitions.forEach((transition, index) => {
    const from = transition.from === null ? 'start' : nodes.get(transition.from)
    const to = nodes.get(transition.to)
    if (from !== undefined && to !== undefined) lines.push(`  ${from} -->|${index + 1}| ${to}`)
  })
  return lines.join('\n')
}
