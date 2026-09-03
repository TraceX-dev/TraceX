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

import contact from '@hcengineering/contact'
import core, { type Class, type Doc, type Hierarchy, type Ref, type RowVisibility } from '@hcengineering/core'

export interface RegisteredRowVisibilityPolicy {
  name: string
  _class: Ref<Class<Doc>>
  policy: RowVisibility
}

export const restrictedRolePolicyClasses: Array<{ name: string, _class: Ref<Class<Doc>> }> = [
  { name: 'core.class.Collaborator', _class: core.class.Collaborator },
  { name: 'contact.class.SocialIdentity', _class: contact.class.SocialIdentity },
  { name: 'love.class.MeetingMinutes', _class: 'love:class:MeetingMinutes' as Ref<Class<Doc>> },
  { name: 'love.class.Room', _class: 'love:class:Room' as Ref<Class<Doc>> },
  { name: 'love.class.Floor', _class: 'love:class:Floor' as Ref<Class<Doc>> },
  { name: 'love.class.RoomInfo', _class: 'love:class:RoomInfo' as Ref<Class<Doc>> },
  { name: 'love.class.ParticipantInfo', _class: 'love:class:ParticipantInfo' as Ref<Class<Doc>> },
  { name: 'love.class.PendingRecording', _class: 'love:class:PendingRecording' as Ref<Class<Doc>> },
  { name: 'love.class.DevicesPreference', _class: 'love:class:DevicesPreference' as Ref<Class<Doc>> },
  { name: 'hr.class.Request', _class: 'hr:class:Request' as Ref<Class<Doc>> },
  { name: 'notification.class.PushSubscription', _class: 'notification:class:PushSubscription' as Ref<Class<Doc>> },
  { name: 'guest.class.PublicLink', _class: 'guest:class:PublicLink' as Ref<Class<Doc>> },
  { name: 'process.class.ApproveRequest', _class: 'process:class:ApproveRequest' as Ref<Class<Doc>> },
  { name: 'pulse.class.DocumentPresence', _class: 'pulse:class:DocumentPresence' as Ref<Class<Doc>> },
  { name: 'pulse.class.TypingIndicator', _class: 'pulse:class:TypingIndicator' as Ref<Class<Doc>> },
  { name: 'chunter.class.ChatMessage', _class: 'chunter:class:ChatMessage' as Ref<Class<Doc>> },
  { name: 'chunter.class.ThreadMessage', _class: 'chunter:class:ThreadMessage' as Ref<Class<Doc>> },
  { name: 'attachment.class.Attachment', _class: 'attachment:class:Attachment' as Ref<Class<Doc>> },
  { name: 'activity.class.SavedMessage', _class: 'activity:class:SavedMessage' as Ref<Class<Doc>> },
  { name: 'card.class.Card', _class: 'card:class:Card' as Ref<Class<Doc>> }
]

export function resolveRegisteredRowVisibilityPolicies (hierarchy: Hierarchy): RegisteredRowVisibilityPolicy[] {
  return restrictedRolePolicyClasses.flatMap(({ name, _class }) => {
    const policy = hierarchy.classHierarchyMixin(_class, core.mixin.RowVisibility)
    return policy === undefined ? [] : [{ name, _class, policy }]
  })
}

export function renderRowVisibilityPolicyTable (hierarchy: Hierarchy): string {
  const header = ['| Class | Read policy | Write policy |', '| --- | --- | --- |']
  const rows = resolveRegisteredRowVisibilityPolicies(hierarchy).map(({ name, policy }) => {
    return `| \`${name}\` | \`${policy.policy.kind}\` | \`${policy.writePolicy?.kind ?? policy.policy.kind}\` |`
  })
  return [...header, ...rows].join('\n')
}
