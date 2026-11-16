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

export type { Handle } from './handle'
export { InvalidHandleError, encodeHandle, decodeHandle } from './handle'
export { getHandle, findByHandle } from './ydoc'
export type {
  AttributeAwareness,
  AttributeSchema,
  SchemaAwareness,
  NodeSchema,
  MarkSchema,
  EditorContext,
  SchemaAwarenessContext,
  AddSchemaAwareness
} from './schema'
export { Awareness, getEditorContext } from './schema'
export * from './operations'
