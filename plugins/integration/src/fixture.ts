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

import core, { generateId, type Class, type Data, type Doc, type Ref } from '@hcengineering/core'
import type { Integration, IntegrationType } from '@hcengineering/setting'

import integration from './plugin'
import type {
  IntegrationRoutingPolicy,
  IntegrationRoutingRule,
  IntegrationRoutingTarget,
  IntegrationSlotBinding,
  IntegrationSlotModel,
  IntegrationSlotProvider,
  IntegrationTargetFactory,
  IntegrationValueResolver
} from './index'

/**
 * @public
 */
export interface IntegrationFixtureExternalObject {
  id: string
  values: Record<string, unknown>
  route?: Record<string, unknown>
  raw?: unknown
}

/**
 * @public
 */
export function createIntegrationFixtureDoc<T extends Doc> (
  _class: Ref<Class<T>>,
  attributes: Data<T>,
  _id: Ref<T> = generateId<T>()
): T {
  return {
    _id,
    _class,
    space: core.space.Model,
    modifiedBy: core.account.System,
    modifiedOn: Date.now(),
    ...attributes
  } as unknown as T
}

/**
 * @public
 */
export function createIntegrationFixtureSlotProvider (
  integrationType: Ref<IntegrationType>,
  label: IntegrationSlotProvider['label'],
  requiredSlots: Record<string, IntegrationSlotModel>,
  optionalSlots?: Record<string, IntegrationSlotModel>
): IntegrationSlotProvider {
  return createIntegrationFixtureDoc(integration.class.IntegrationSlotProvider, {
    integrationType,
    label,
    requiredSlots,
    optionalSlots
  })
}

/**
 * @public
 */
export function createIntegrationFixtureSlotBinding (
  provider: Ref<IntegrationSlotProvider>,
  targetClass: Ref<Class<Doc>>,
  bindings: Record<string, string>
): IntegrationSlotBinding {
  return createIntegrationFixtureDoc(integration.class.IntegrationSlotBinding, {
    provider,
    targetClass,
    bindings
  })
}

/**
 * @public
 */
export function createIntegrationFixtureRoutingPolicy (
  integrationRef: Ref<Integration>,
  provider: Ref<IntegrationSlotProvider>,
  rules: IntegrationRoutingRule[],
  fallback?: IntegrationRoutingTarget
): IntegrationRoutingPolicy {
  return createIntegrationFixtureDoc(integration.class.IntegrationRoutingPolicy, {
    integration: integrationRef,
    provider,
    rules,
    fallback
  })
}

/**
 * @public
 */
export function createIntegrationFixtureTargetFactory (
  targetClass: Ref<Class<Doc>>,
  factory: Pick<
  IntegrationTargetFactory,
  'create' | 'update' | 'canCreate' | 'getAllowedSpaceClasses' | 'getCommentBackend'
  >
): IntegrationTargetFactory {
  return createIntegrationFixtureDoc(integration.class.IntegrationTargetFactory, {
    targetClass,
    ...factory
  })
}

/**
 * @public
 */
export function createIntegrationFixtureValueResolver (
  provider: Ref<IntegrationSlotProvider>,
  slot: string,
  resolver: IntegrationValueResolver['resolver']
): IntegrationValueResolver {
  return createIntegrationFixtureDoc(integration.class.IntegrationValueResolver, {
    provider,
    slot,
    resolver
  })
}
