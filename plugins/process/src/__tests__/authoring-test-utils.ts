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

import type { AuthoringNativeDocument } from '../authoring'

/** Compares all native data and branch priority, allowing regenerated storage ranks and document order. */
export function expectEquivalentModel (actual: AuthoringNativeDocument[], expected: AuthoringNativeDocument[]): void {
  const values = (docs: AuthoringNativeDocument[]): unknown[] =>
    docs.map(({ rank, ...doc }) => doc).sort((a, b) => a._id.localeCompare(b._id))
  expect(values(actual)).toEqual(values(expected))
  const groups = new Map<string, AuthoringNativeDocument[]>()
  for (const doc of expected) {
    if (typeof doc.rank !== 'string') continue
    const key = [doc._class, doc.process ?? doc.attributeOf ?? doc.extends ?? '', doc.from ?? ''].join(':')
    const group = groups.get(key) ?? []
    group.push(doc)
    groups.set(key, group)
  }
  for (const docs of groups.values()) {
    const ranks = new Map(actual.map((doc) => [doc._id, String(doc.rank)]))
    for (const left of docs) {
      for (const right of docs) {
        if (String(left.rank) < String(right.rank)) {
          expect(String(ranks.get(left._id)) < String(ranks.get(right._id))).toBe(true)
        }
      }
    }
  }
}
