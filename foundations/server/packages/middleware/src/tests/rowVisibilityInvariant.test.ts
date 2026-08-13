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

/**
 * CI invariant: every class `SpaceSecurityMiddleware` row-level-restricts must declare
 * `core.mixin.RowVisibility` - a missing policy should fail the build, not a later review.
 *
 * Scope: only the 6 classes restricted today. Widening to every class outside ordinary space
 * filtering platform-wide needs a full audit first (dozens of classes are in `core.space.Workspace`
 * for unrelated reasons - shared tags, reactions, global settings, ...) - see the design doc.
 */

import core, { type Class, type Doc, type Hierarchy, type Ref } from '@hcengineering/core'
import buildModel from '@hcengineering/model-all'

const SENSITIVE_CLASSES: Array<{ name: string, _class: Ref<Class<Doc>> }> = [
  { name: 'core.class.Collaborator', _class: core.class.Collaborator },
  { name: 'love.class.MeetingMinutes', _class: 'love:class:MeetingMinutes' as Ref<Class<Doc>> },
  { name: 'love.class.RoomInfo', _class: 'love:class:RoomInfo' as Ref<Class<Doc>> },
  { name: 'hr.class.Request', _class: 'hr:class:Request' as Ref<Class<Doc>> },
  { name: 'notification.class.PushSubscription', _class: 'notification:class:PushSubscription' as Ref<Class<Doc>> },
  { name: 'guest.class.PublicLink', _class: 'guest:class:PublicLink' as Ref<Class<Doc>> }
]

describe('RowVisibility invariant', () => {
  let hierarchy: Hierarchy

  beforeAll(() => {
    hierarchy = buildModel().hierarchy
  })

  it.each(SENSITIVE_CLASSES)('$name declares core.mixin.RowVisibility', ({ _class }) => {
    const mixin = hierarchy.classHierarchyMixin(_class, core.mixin.RowVisibility)
    expect(mixin).toBeDefined()
    expect(mixin?.policy).toBeDefined()
    expect(typeof mixin?.allowKnownIdBypass).toBe('boolean')
  })

  it('guest.class.PublicLink is scoped to _id, not a bypassable field (regression guard for the linkId-enumeration fix)', () => {
    const mixin = hierarchy.classHierarchyMixin(
      'guest:class:PublicLink' as Ref<Class<Doc>>,
      core.mixin.RowVisibility
    )
    expect(mixin?.policy).toEqual({ kind: 'ownerField', field: '_id', identity: 'linkId' })
    expect(mixin?.allowKnownIdBypass).toBe(false)
  })
})
