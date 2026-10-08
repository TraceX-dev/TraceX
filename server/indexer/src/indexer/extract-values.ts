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

/** Extracts scalar values from a JSON-like attribute for full-text indexing. */
export function extractValues (input: unknown): string {
  let result = ''
  const values: unknown[] = [input]

  for (const value of values) {
    if (value === null || value === undefined) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        values.push(item)
      }
      continue
    }
    if (typeof value === 'object') {
      for (const nestedValue of Object.values(value)) {
        values.push(nestedValue)
      }
      continue
    }
    result += `${String(value)} `
  }
  return result
}
