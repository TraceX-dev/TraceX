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

import type { Node as PMNode } from '@tiptap/pm/model'
import { XmlElement, XmlFragment } from 'yjs'
import type { Doc } from 'yjs'
import { encodeHandle } from '../handle'
import { getHandle } from '../ydoc'
import { AgentOperationFailure } from './schema'
import type { AgentReferenceSource, AgentScope } from './types'

/**
 * Bind the live XML elements of a field to mapped ProseMirror nodes using client/clock handles.
 * Use the mapping from initProseMirrorDoc within the same synchronous operation.
 * Recreate references after a document change or await. Missing fields remain absent.
 */
export function createYjsReferences (
  document: Doc,
  mapping: ReadonlyMap<unknown, PMNode | PMNode[]>,
  scope: AgentScope
): AgentReferenceSource {
  const fragment = document.share.get(scope.field)
  if (fragment !== undefined && !(fragment instanceof XmlFragment)) {
    throw new AgentOperationFailure('INVALID_OPERATION', 'Expected an XML fragment for the requested field.')
  }
  const handles = new WeakMap<object, string>()
  const visit = (parent: XmlFragment): void => {
    for (const child of parent.toArray()) {
      if (!(child instanceof XmlElement)) continue
      const node = mapping.get(child)
      if (node === undefined || Array.isArray(node)) {
        throw new AgentOperationFailure('UNSUPPORTED_SCHEMA', 'A live XML container has no mapped ProseMirror node.')
      }
      if (node.type.name !== child.nodeName) {
        throw new AgentOperationFailure('STALE_REFERENCE', 'The XML container and mapped node types differ.')
      }
      if (handles.has(node)) {
        throw new AgentOperationFailure('AMBIGUOUS_REF', 'Multiple containers map to the same ProseMirror node.')
      }
      handles.set(node, encodeHandle(getHandle(child)))
      visit(child)
    }
  }
  if (fragment !== undefined) visit(fragment)
  return {
    document: scope.document,
    field: scope.field,
    refForNode: (node) => {
      const handle = handles.get(node)
      if (handle === undefined) {
        throw new AgentOperationFailure('STALE_REFERENCE', 'The node is not mapped to a live container in this field.')
      }
      return handle
    }
  }
}
