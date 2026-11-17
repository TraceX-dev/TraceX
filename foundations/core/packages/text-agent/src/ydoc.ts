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

import { XmlElement, XmlFragment, RelativePosition, createID, createAbsolutePositionFromRelativePosition } from 'yjs'
import type { Doc } from 'yjs'
import type { Handle } from './handle'

function isLiveElement (element: XmlElement): boolean {
  const doc = element.doc
  if (doc === null || doc.isDestroyed) return false
  let current: XmlFragment = element
  while (current.parent !== null) {
    const parent = current.parent
    if (!(parent instanceof XmlFragment) || !parent.toArray().some((child) => child === current)) return false
    current = parent
  }
  return Array.from(doc.share.values()).some((root: unknown) => root === current)
}

/** Obtain the creation identity of an attached, live XML element without changing its document. */
export function getHandle (element: XmlElement): Handle {
  if (!isLiveElement(element)) {
    throw new TypeError('Expected a live XML element attached to a document fragment.')
  }

  const id = element._item?.id
  if (id === undefined) {
    throw new TypeError('Root shared types do not have an element handle.')
  }

  return { client: id.client, clock: id.clock }
}

/**
 * Resolve the exact live XML element in this Y.Doc. Missing/deleted/non-XML identities return undefined.
 * Initialize XML root fields with doc.getXmlFragment after loading binary state, as required by Yjs.
 * No lookup by content, path, UUID, neighboring positions or undo replacements is performed.
 */
export function findByHandle (doc: Doc, handle: Handle): XmlElement | undefined {
  if (doc.isDestroyed) {
    return undefined
  }

  const relative = new RelativePosition(createID(handle.client, handle.clock), null, null, -1)
  const absolute = createAbsolutePositionFromRelativePosition(relative, doc, false)
  const element = absolute?.type
  return element instanceof XmlElement && isLiveElement(element) ? element : undefined
}
