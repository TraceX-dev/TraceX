//
// Copyright © 2025 Hardcore Engineering Inc.
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

import { type Class, type Doc, type Ref } from '@hcengineering/core'

/**
 * Per-object-class binding describing how a document type exposes its collaborative
 * body for Word import/export. Keeps the conversion layer object-agnostic: controlled
 * documents are the first consumer, other classes (Teamspace Document, Card, ...) plug
 * in by registering a provider — no change to the converter or endpoints.
 *
 * @public
 */
export interface DocContentProvider<T extends Doc = Doc> {
  /** Collaborative attribute holding the document body (e.g. 'content'). */
  collabField: string
  /** Human-facing title, used for the export file name. */
  getTitle?: (doc: T) => string
}

const registry = new Map<Ref<Class<Doc>>, DocContentProvider>()

/** @public */
export function registerDocContentProvider<T extends Doc> (
  _class: Ref<Class<T>>,
  provider: DocContentProvider<T>
): void {
  registry.set(_class, provider as DocContentProvider)
}

/** @public */
export function getDocContentProvider (_class: Ref<Class<Doc>>): DocContentProvider | undefined {
  return registry.get(_class)
}
