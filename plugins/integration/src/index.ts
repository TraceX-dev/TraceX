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

import type { Class, Client, Doc, Domain, Ref, Space, TxOperations, Type } from '@hcengineering/core'
import { type IntlString, type Resource } from '@hcengineering/platform'
import type { Integration, IntegrationType } from '@hcengineering/setting'
import type { AnyComponent } from '@hcengineering/ui'

import integration, { integrationId } from './plugin'

export * from './utils'
export * from './fixture'
export { integrationId }

/**
 * @public
 */
export const DOMAIN_INTEGRATION = 'integration' as Domain

/**
 * @public
 */
export interface IntegrationSlotModel {
  slotKind: 'attribute' | 'class'
  _class: Ref<Class<Doc>>
  label?: IntlString
  name?: string
  memberOf?: string
  values?: IntegrationValueOption[]
}

/**
 * @public
 */
export interface IntegrationAttributeSlotModel extends IntegrationSlotModel {
  slotKind: 'attribute'
  type: Type<any>
  types?: Array<Type<any>>
}

/**
 * @public
 */
export interface IntegrationSlotProvider extends Doc {
  integrationType: Ref<IntegrationType>
  label: IntlString
  requiredSlots: Record<string, IntegrationSlotModel>
  optionalSlots?: Record<string, IntegrationSlotModel>
  configureComponent?: AnyComponent
  presenter?: AnyComponent
}

/**
 * @public
 */
export interface IntegrationSlotBinding extends Doc {
  provider: Ref<IntegrationSlotProvider>
  targetClass: Ref<Class<Doc>>
  bindings: Record<string, string>
  valueMappings?: Record<string, IntegrationValueMapping>
}

/**
 * @public
 */
export interface IntegrationValueOption {
  value: string
  label?: IntlString
}

/**
 * @public
 */
export type IntegrationValueMappingMode = 'copy' | 'map' | 'ignore'

/**
 * @public
 */
export interface IntegrationValueMapping {
  mode: IntegrationValueMappingMode
  values?: Record<string, string>
}

/**
 * @public
 */
export interface IntegrationRoutingPolicy extends Doc {
  integration: Ref<Integration>
  provider: Ref<IntegrationSlotProvider>
  rules: IntegrationRoutingRule[]
  fallback?: IntegrationRoutingTarget
}

/**
 * @public
 */
export interface IntegrationRoutingRule {
  externalPattern?: string
  space?: Ref<Space>
  targetClass?: Ref<Class<Doc>>
  target?: IntegrationRoutingTarget
  resolver?: Resource<ResolveIntegrationRoute>
}

/**
 * @public
 */
export interface IntegrationRoutingTarget {
  space?: Ref<Space>
  targetClass: Ref<Class<Doc>>
}

/**
 * @public
 */
export interface IntegrationTargetContext {
  client: TxOperations & Client
  integration: Ref<Integration>
  provider: Ref<IntegrationSlotProvider>
}

/**
 * @public
 */
export interface IntegrationTargetFactory extends Doc {
  targetClass: Ref<Class<Doc>>
  create: Resource<CreateIntegrationTarget>
  update?: Resource<UpdateIntegrationTarget>
  canCreate?: Resource<CanCreateIntegrationTarget>
  getAllowedSpaceClasses?: Resource<GetIntegrationTargetAllowedSpaceClasses>
  getCommentBackend?: Resource<GetIntegrationTargetCommentBackend>
}

/**
 * @public
 */
export type CreateIntegrationTarget = (
  ctx: IntegrationTargetContext,
  target: IntegrationRoutingTarget,
  values: Record<string, unknown>
) => Promise<Doc>

/**
 * @public
 */
export type UpdateIntegrationTarget = (
  ctx: IntegrationTargetContext,
  doc: Doc,
  values: Record<string, unknown>
) => Promise<void>

/**
 * @public
 */
export type CanCreateIntegrationTarget = (
  ctx: IntegrationTargetContext,
  target: IntegrationRoutingTarget
) => Promise<boolean>

/**
 * @public
 */
export type GetIntegrationTargetAllowedSpaceClasses = (
  client: Client,
  targetClass: Ref<Class<Doc>>
) => Promise<Array<Ref<Class<Space>>>>

/**
 * @public
 */
export type IntegrationTargetCommentBackend = 'chunter' | 'communication'

/**
 * @public
 */
export type GetIntegrationTargetCommentBackend = (
  ctx: IntegrationTargetContext,
  doc: Doc
) => Promise<IntegrationTargetCommentBackend>

/**
 * @public
 */
export interface IntegrationValueResolver extends Doc {
  provider: Ref<IntegrationSlotProvider>
  slot: string
  resolver: Resource<ResolveIntegrationValue>
}

/**
 * @public
 */
export type ResolveIntegrationValue = (
  integration: Ref<Integration>,
  external: unknown,
  context: Record<string, unknown>
) => Promise<unknown>

/**
 * @public
 */
export type ResolveIntegrationRoute = (
  integration: Ref<Integration>,
  external: unknown,
  context: Record<string, unknown>
) => Promise<IntegrationRoutingTarget | undefined>

export default integration
