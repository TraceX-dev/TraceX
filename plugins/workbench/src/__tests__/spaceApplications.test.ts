//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import type { Class, Hierarchy, Ref, Space } from '@hcengineering/core'

import { createSpaceApplicationResolver } from '../spaceApplications'
import type { Application, ApplicationNavModel } from '../types'

const BASE_SPACE = 'test:class:BaseSpace' as Ref<Class<Space>>
const CHILD_SPACE = 'test:class:ChildSpace' as Ref<Class<Space>>
const OTHER_SPACE = 'test:class:OtherSpace' as Ref<Class<Space>>

function application (
  id: string,
  alias: string,
  spaceClasses?: Array<Ref<Class<Space>>>,
  spaceIds?: Array<Ref<Space>>
): Application {
  return { _id: id, alias, order: 1, spaceClasses, spaceIds } as unknown as Application
}

function space (id: string, spaceClass: Ref<Class<Space>>): Space {
  return { _id: id, _class: spaceClass } as unknown as Space
}

const hierarchy: Pick<Hierarchy, 'getAncestors'> = {
  getAncestors: (spaceClass: Ref<Class<Space>>) => (spaceClass === CHILD_SPACE ? [BASE_SPACE] : [])
}

describe('space application resolver', () => {
  it('resolves exact and inherited space classes', () => {
    const app = application('app', 'app', [BASE_SPACE])
    const resolver = createSpaceApplicationResolver(hierarchy, [app])

    expect(resolver.resolve(space('base', BASE_SPACE))).toBe(app)
    expect(resolver.resolve(space('child', CHILD_SPACE))).toBe(app)
  })

  it('prefers an explicit mapping over a navigator fallback', () => {
    const fallback = application('fallback', 'fallback')
    const explicit = application('explicit', 'explicit', [BASE_SPACE])
    const navigationModels = [
      { extends: fallback._id, spaces: [{ id: 'spaces', spaceClass: BASE_SPACE }] }
    ] as ApplicationNavModel[]
    const resolver = createSpaceApplicationResolver(hierarchy, [fallback, explicit], navigationModels)

    expect(resolver.resolve(space('space', BASE_SPACE))).toBe(explicit)
  })

  it('prefers a space id mapping over a shared class mapping', () => {
    const byClass = application('class-app', 'class-app', [BASE_SPACE])
    const byId = application('id-app', 'id-app', undefined, ['special' as Ref<Space>])
    const resolver = createSpaceApplicationResolver(hierarchy, [byClass, byId])

    expect(resolver.resolve(space('special', BASE_SPACE))).toBe(byId)
    expect(resolver.resolve(space('regular', BASE_SPACE))).toBe(byClass)
  })

  it('groups unresolved spaces last', () => {
    const app = application('app', 'app', [BASE_SPACE])
    const resolver = createSpaceApplicationResolver(hierarchy, [app])
    const resolvedSpace = space('resolved', BASE_SPACE)
    const unresolvedSpace = space('unresolved', OTHER_SPACE)

    expect(resolver.group([unresolvedSpace, resolvedSpace])).toEqual([
      { application: app, spaces: [resolvedSpace] },
      { application: undefined, spaces: [unresolvedSpace] }
    ])
  })
})
