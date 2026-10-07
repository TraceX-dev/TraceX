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

import type { Doc, Ref, Space } from '@hcengineering/core'
import {
  ambientPeopleScope,
  getAmbientPeopleScope,
  makePeopleScope,
  peopleScopeKey,
  providePeopleScope,
  resolvePeopleScope
} from '../peopleScope'

const spaceA = 'spaceA' as Ref<Space>
const spaceB = 'spaceB' as Ref<Space>
const docA = 'docA' as Ref<Doc>

describe('people scope', () => {
  it('makePeopleScope returns undefined without context', () => {
    expect(makePeopleScope()).toBeUndefined()
    expect(makePeopleScope(null, null)).toBeUndefined()
    expect(makePeopleScope(spaceA)).toEqual({ space: spaceA, objectId: undefined })
    expect(makePeopleScope(undefined, docA)).toEqual({ space: undefined, objectId: docA })
  })

  it('peopleScopeKey distinguishes opt-out, unset and scopes', () => {
    expect(peopleScopeKey(null)).not.toEqual(peopleScopeKey(undefined))
    expect(peopleScopeKey({ space: spaceA })).toEqual(peopleScopeKey({ space: spaceA, objectId: undefined }))
    expect(peopleScopeKey({ space: spaceA })).not.toEqual(peopleScopeKey({ space: spaceB }))
  })

  it('the latest provided scope wins and is restored on dispose', () => {
    const values: unknown[] = []
    const unsubscribe = ambientPeopleScope.subscribe((it) => values.push(it))

    const panel = providePeopleScope({ space: spaceA, objectId: docA })
    expect(getAmbientPeopleScope()).toEqual({ space: spaceA, objectId: docA })

    const aside = providePeopleScope({ space: spaceB })
    expect(getAmbientPeopleScope()).toEqual({ space: spaceB })

    aside.dispose()
    expect(getAmbientPeopleScope()).toEqual({ space: spaceA, objectId: docA })

    panel.dispose()
    expect(getAmbientPeopleScope()).toBeUndefined()

    unsubscribe()
    expect(values).toEqual([
      undefined,
      { space: spaceA, objectId: docA },
      { space: spaceB },
      { space: spaceA, objectId: docA },
      undefined
    ])
  })

  it('a view without a loaded object does not hide the scope below it', () => {
    const panel = providePeopleScope({ space: spaceA })
    const loading = providePeopleScope()
    expect(getAmbientPeopleScope()).toEqual({ space: spaceA })

    loading.set({ space: spaceB })
    expect(getAmbientPeopleScope()).toEqual({ space: spaceB })

    // Closing the panel underneath keeps the aside scope
    panel.dispose()
    expect(getAmbientPeopleScope()).toEqual({ space: spaceB })

    loading.dispose()
    // Disposing twice is harmless
    loading.dispose()
    loading.set({ space: spaceA })
    expect(getAmbientPeopleScope()).toBeUndefined()
  })

  it('does not notify subscribers about an unchanged scope', () => {
    const panel = providePeopleScope({ space: spaceA })
    let calls = 0
    const unsubscribe = ambientPeopleScope.subscribe(() => calls++)
    panel.set({ space: spaceA })
    panel.set({ space: spaceA, objectId: undefined })
    expect(calls).toEqual(1)
    unsubscribe()
    panel.dispose()
  })

  it('an explicit scope or opt-out wins over the ambient one', () => {
    const panel = providePeopleScope({ space: spaceA })
    expect(resolvePeopleScope(undefined)).toEqual({ space: spaceA })
    expect(resolvePeopleScope({ space: spaceB })).toEqual({ space: spaceB })
    expect(resolvePeopleScope(null)).toBeNull()
    panel.dispose()
    expect(resolvePeopleScope(undefined)).toBeUndefined()
  })
})
