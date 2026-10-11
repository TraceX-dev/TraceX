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

/** Downloads a card or process definition using the selected serialization format. */
export function downloadDefinition (source: string, name: string, format: 'json' | 'yaml'): void {
  const blob = new Blob([source], { type: format === 'json' ? 'application/json' : 'application/yaml' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}.${format}`
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 0)
  }
}

/** Provides a minimal valid starting document for the YAML editor. */
export function newDefinitionYaml (kind: 'card' | 'process'): string {
  return kind === 'card'
    ? 'version: 1\nkind: card\ncard:\n  key: new_card\n  label: New card type\n  fields:\n    summary:\n      type: string\n'
    : 'version: 1\nkind: process\nprocess:\n  key: new_process\n  label: New process\n  slots: {}\n  start:\n    to: done\n  states:\n    done: {}\n'
}
