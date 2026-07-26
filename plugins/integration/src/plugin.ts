//
// Copyright © 2026 Hardcore Engineering Inc.
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

import type { Class, Ref } from '@hcengineering/core'
import { type IntlString, type Plugin, plugin } from '@hcengineering/platform'

import type {
  IntegrationRoutingPolicy,
  IntegrationSlotBinding,
  IntegrationSlotProvider,
  IntegrationTargetFactory,
  IntegrationValueResolver
} from './index'

/**
 * @public
 */
export const integrationId = 'integration' as Plugin

export default plugin(integrationId, {
  class: {
    IntegrationSlotProvider: '' as Ref<Class<IntegrationSlotProvider>>,
    IntegrationSlotBinding: '' as Ref<Class<IntegrationSlotBinding>>,
    IntegrationRoutingPolicy: '' as Ref<Class<IntegrationRoutingPolicy>>,
    IntegrationTargetFactory: '' as Ref<Class<IntegrationTargetFactory>>,
    IntegrationValueResolver: '' as Ref<Class<IntegrationValueResolver>>
  },
  string: {
    IntegrationSlotProvider: '' as IntlString,
    IntegrationSlotBinding: '' as IntlString,
    IntegrationRoutingPolicy: '' as IntlString,
    IntegrationTargetFactory: '' as IntlString,
    IntegrationValueResolver: '' as IntlString,
    RequiredSlots: '' as IntlString,
    OptionalSlots: '' as IntlString,
    TargetClass: '' as IntlString,
    Bindings: '' as IntlString,
    ValueMappings: '' as IntlString,
    Rules: '' as IntlString,
    Fallback: '' as IntlString
  }
})
