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

import core, { DOMAIN_MODEL, type Class, type Doc, type Ref } from '@hcengineering/core'
import {
  DOMAIN_INTEGRATION,
  type IntegrationRoutingPolicy,
  type IntegrationRoutingRule,
  type IntegrationRoutingTarget,
  type IntegrationSlotBinding,
  type IntegrationSlotProvider,
  type IntegrationTargetFactory,
  type IntegrationValueResolver,
  type IntegrationSlotModel,
  type IntegrationValueMapping,
  type CanCreateIntegrationTarget,
  type CreateIntegrationTarget,
  type UpdateIntegrationTarget,
  type GetIntegrationTargetAllowedSpaceClasses,
  type GetIntegrationTargetCommentBackend,
  type ResolveIntegrationValue,
  integrationId
} from '@hcengineering/integration'
import {
  ArrOf,
  type Builder,
  Model,
  Prop,
  TypeIntlString,
  TypeRecord,
  TypeRef,
  TypeString,
  UX
} from '@hcengineering/model'
import { TDoc } from '@hcengineering/model-core'
import { type IntlString, type Resource } from '@hcengineering/platform'
import setting, { type Integration, type IntegrationType } from '@hcengineering/setting'
import { type AnyComponent } from '@hcengineering/ui'

import integration from './plugin'

export { integrationId } from '@hcengineering/integration'
export { default } from './plugin'

@Model(integration.class.IntegrationSlotProvider, core.class.Doc, DOMAIN_MODEL)
@UX(integration.string.IntegrationSlotProvider)
export class TIntegrationSlotProvider extends TDoc implements IntegrationSlotProvider {
  @Prop(TypeRef(setting.class.IntegrationType), setting.string.Integrations)
    integrationType!: Ref<IntegrationType>

  @Prop(TypeIntlString(), core.string.Name)
    label!: IntlString

  @Prop(TypeRecord(), integration.string.RequiredSlots)
    requiredSlots!: Record<string, IntegrationSlotModel>

  @Prop(TypeRecord(), integration.string.OptionalSlots)
    optionalSlots?: Record<string, IntegrationSlotModel>

  configureComponent?: AnyComponent

  presenter?: AnyComponent
}

@Model(integration.class.IntegrationSlotBinding, core.class.Doc, DOMAIN_INTEGRATION)
@UX(integration.string.IntegrationSlotBinding)
export class TIntegrationSlotBinding extends TDoc implements IntegrationSlotBinding {
  @Prop(TypeRef(integration.class.IntegrationSlotProvider), integration.string.IntegrationSlotProvider)
    provider!: Ref<IntegrationSlotProvider>

  @Prop(TypeRef(core.class.Class), integration.string.TargetClass)
    targetClass!: Ref<Class<Doc>>

  @Prop(TypeRecord(), integration.string.Bindings)
    bindings!: Record<string, string>

  @Prop(TypeRecord(), integration.string.ValueMappings)
    valueMappings?: Record<string, IntegrationValueMapping>
}

@Model(integration.class.IntegrationRoutingPolicy, core.class.Doc, DOMAIN_INTEGRATION)
@UX(integration.string.IntegrationRoutingPolicy)
export class TIntegrationRoutingPolicy extends TDoc implements IntegrationRoutingPolicy {
  @Prop(TypeRef(setting.class.Integration), setting.string.Integrations)
    integration!: Ref<Integration>

  @Prop(TypeRef(integration.class.IntegrationSlotProvider), integration.string.IntegrationSlotProvider)
    provider!: Ref<IntegrationSlotProvider>

  @Prop(ArrOf(TypeRecord()), integration.string.Rules)
    rules!: IntegrationRoutingRule[]

  @Prop(TypeRecord(), integration.string.Fallback)
    fallback?: IntegrationRoutingTarget
}

@Model(integration.class.IntegrationTargetFactory, core.class.Doc, DOMAIN_MODEL)
@UX(integration.string.IntegrationTargetFactory)
export class TIntegrationTargetFactory extends TDoc implements IntegrationTargetFactory {
  @Prop(TypeRef(core.class.Class), integration.string.TargetClass)
    targetClass!: Ref<Class<Doc>>

  create!: Resource<CreateIntegrationTarget>

  update?: Resource<UpdateIntegrationTarget>

  canCreate?: Resource<CanCreateIntegrationTarget>

  getAllowedSpaceClasses?: Resource<GetIntegrationTargetAllowedSpaceClasses>

  getCommentBackend?: Resource<GetIntegrationTargetCommentBackend>
}

@Model(integration.class.IntegrationValueResolver, core.class.Doc, DOMAIN_MODEL)
@UX(integration.string.IntegrationValueResolver)
export class TIntegrationValueResolver extends TDoc implements IntegrationValueResolver {
  @Prop(TypeRef(integration.class.IntegrationSlotProvider), integration.string.IntegrationSlotProvider)
    provider!: Ref<IntegrationSlotProvider>

  @Prop(TypeString(), core.string.Name)
    slot!: string

  resolver!: Resource<ResolveIntegrationValue>
}

export function createModel (builder: Builder): void {
  builder.createModel(
    TIntegrationSlotProvider,
    TIntegrationSlotBinding,
    TIntegrationRoutingPolicy,
    TIntegrationTargetFactory,
    TIntegrationValueResolver
  )
}
