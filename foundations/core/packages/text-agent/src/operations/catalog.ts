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

import { getEditorContext } from '../schema'
import type { Awareness, MarkSchema, NodeSchema } from '../schema'

/** Generate a tool catalog from the supplied editor schema and metadata. */
export function getAgentSchemaCatalog (awareness: Awareness): string {
  const context = getEditorContext(awareness)
  const nodes = Object.values(context.nodes)
  const describe = (item: NodeSchema | MarkSchema): string => {
    const attrs = Object.values(item.attributes)
      .filter((attr) => attr.hidden !== true && attr.access !== 'readonly')
      .map((attr) => (attr.enum === undefined ? attr.name : `${attr.name}=${attr.enum.join('|')}`))
    const signature = item.name + (attrs.length === 0 ? '' : `(${attrs.join(', ')})`)
    const description = item.description?.split(/(?<=\.)\s/)[0] ?? item.label
    return description === undefined ? signature : `${signature}: ${description}`
  }
  const nesting = nodes
    .filter(
      (node) =>
        !node.inline &&
        node.content !== '' &&
        (!['block+', 'inline*', 'text*'].includes(node.content) ||
          (node.name !== context.topNode && !context.nodes[context.topNode].allowedChildren.includes(node.name)))
    )
    .map((node) => {
      const parents = nodes.filter((parent) => parent.allowedChildren.includes(node.name)).map((parent) => parent.name)
      const content = node.content.replace(/[A-Za-z_][A-Za-z_0-9-]*/g, (name) => {
        if (Object.hasOwn(context.nodes, name) || name === 'block' || name === 'inline') return name
        const members = nodes.filter((child) => child.group?.split(' ').includes(name)).map((child) => child.name)
        return members.length === 0 ? name : `(${members.join('|')})`
      })
      return (
        `${node.name}: ${content}` +
        (node.name !== context.topNode && !parents.includes(context.topNode)
          ? `; only inside ${parents.join('|')}`
          : '')
      )
    })
  return [
    `Nodes (block):\n${nodes
      .filter((node) => !node.inline)
      .map(describe)
      .join('\n')}`,
    `Nodes (inline):\n${nodes
      .filter((node) => node.inline)
      .map(describe)
      .join('\n')}`,
    `Marks:\n${Object.values(context.marks).map(describe).join('\n')}`,
    `Nesting (native content expressions):\n${nesting.join('\n')}`
  ].join('\n')
}
