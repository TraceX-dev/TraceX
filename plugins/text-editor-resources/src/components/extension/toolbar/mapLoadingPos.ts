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
import { type Node } from '@tiptap/pm/model'
import { type Mapping } from '@tiptap/pm/transform'

/**
 * Maps the position of a loading node through a change. Text typed exactly at the node
 * position can go on either side, so try both and keep the one that still points at a node
 * of the same type. Returns `undefined` if the node is gone, so no stale entry stays behind.
 */
export function mapLoadingPos (pos: number, mapping: Mapping, oldDoc: Node, newDoc: Node): number | undefined {
  if (pos < 0 || pos > oldDoc.content.size) return undefined
  const oldNode = oldDoc.nodeAt(pos)
  if (oldNode === null) return undefined

  for (const assoc of [-1, 1]) {
    const mapped = mapping.map(pos, assoc)
    if (mapped >= 0 && mapped < newDoc.content.size && newDoc.nodeAt(mapped)?.type === oldNode.type) {
      return mapped
    }
  }
  return undefined
}
