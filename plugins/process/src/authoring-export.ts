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

import { exportAuthoringModel } from './authoring-model'
import { object, text } from './authoring-validation'

/** Exports every definition through the single named-block YAML authoring format. */
export function exportProcessYaml (documents: readonly unknown[], kind: 'card' | 'process'): string {
  return exportAuthoringModel(documents, kind)
}

/** Exports a process draft and its existing field bindings for the UI editor. */
export function exportProcessYamlDraft (documents: readonly unknown[]): {
  source: string
  bindings: Record<string, string>
} {
  const source = exportAuthoringModel(documents, 'process')
  const proc = documents.map((doc) => object(doc, 'document')).find((doc) => doc._class === 'process:class:Process')
  return {
    source,
    bindings: Object.fromEntries(
      Object.entries(object(proc?.bindings ?? {}, 'process.bindings')).map(([key, value]) => [
        key,
        text(value, `process.bindings.${key}`)
      ])
    )
  }
}
