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

import core, { type Class, type Client, type Doc, type Ref, type Space, type TxOperations } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'

import integration from './plugin'
import type {
  IntegrationRoutingPolicy,
  IntegrationRoutingRule,
  IntegrationRoutingTarget,
  IntegrationSlotBinding,
  IntegrationSlotProvider,
  IntegrationTargetCommentBackend,
  IntegrationTargetContext,
  IntegrationTargetFactory,
  IntegrationValueMapping,
  IntegrationValueResolver
} from './index'

/**
 * @public
 */
export interface IntegrationRouteMatchContext {
  externalPattern?: string
  space?: Ref<Space>
  targetClass?: Ref<Class<Doc>>
  [key: string]: unknown
}

/**
 * @public
 */
export interface SaveIntegrationSetupResult {
  binding: IntegrationSlotBinding
  policy: IntegrationRoutingPolicy
}

/**
 * @public
 */
export interface SaveIntegrationSetupParams {
  integration: IntegrationRoutingPolicy['integration']
  provider: Ref<IntegrationSlotProvider>
  targetClass: Ref<Class<Doc>>
  bindings: Record<string, string>
  valueMappings?: Record<string, IntegrationValueMapping>
  fallback: IntegrationRoutingTarget
}

/**
 * @public
 */
export function getMissingRequiredSlots (
  provider: IntegrationSlotProvider,
  binding: IntegrationSlotBinding | undefined
): string[] {
  const bindings = binding?.bindings ?? {}
  return Object.keys(provider.requiredSlots).filter((slot) => bindings[slot] === undefined)
}

/**
 * @public
 */
export function isIntegrationSlotBindingComplete (
  provider: IntegrationSlotProvider,
  binding: IntegrationSlotBinding | undefined
): boolean {
  return getMissingRequiredSlots(provider, binding).length === 0
}

/**
 * @public
 */
export function matchesIntegrationRoutingRule (
  rule: IntegrationRoutingRule,
  context: IntegrationRouteMatchContext
): boolean {
  if (rule.externalPattern !== undefined && rule.externalPattern !== context.externalPattern) {
    return false
  }
  if (rule.space !== undefined && rule.space !== context.space) {
    return false
  }
  if (rule.targetClass !== undefined && rule.targetClass !== context.targetClass) {
    return false
  }
  return true
}

/**
 * @public
 */
export async function resolveIntegrationRoute (
  policy: IntegrationRoutingPolicy,
  external: unknown,
  context: IntegrationRouteMatchContext = {}
): Promise<IntegrationRoutingTarget | undefined> {
  for (const rule of policy.rules) {
    if (!matchesIntegrationRoutingRule(rule, context)) {
      continue
    }

    if (rule.resolver !== undefined) {
      const resolver = await getResource(rule.resolver)
      const target = await resolver(policy.integration, external, context)
      if (target !== undefined) {
        return target
      }
    }

    if (rule.target !== undefined) {
      return rule.target
    }
  }

  return policy.fallback
}

/**
 * @public
 */
export async function findIntegrationTargetFactory (
  client: Client,
  targetClass: Ref<Class<Doc>>
): Promise<IntegrationTargetFactory | undefined> {
  const exactFactory = await client.findOne(integration.class.IntegrationTargetFactory, { targetClass })
  if (exactFactory !== undefined) {
    return exactFactory
  }

  const hierarchy = client.getHierarchy()
  const factories = await client.findAll(integration.class.IntegrationTargetFactory, {})
  const candidates = factories.filter((factory) => hierarchy.isDerived(targetClass, factory.targetClass))
  candidates.sort((a, b) => {
    return hierarchy.getAncestors(b.targetClass).length - hierarchy.getAncestors(a.targetClass).length
  })
  return candidates[0]
}

/**
 * @public
 */
export function applyIntegrationSlotBinding (
  values: Record<string, unknown>,
  binding: IntegrationSlotBinding
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [slot, value] of Object.entries(values)) {
    const target = binding.bindings[slot]
    if (target === undefined) continue

    const mappedValue = applyIntegrationValueMapping(value, binding.valueMappings?.[slot])
    if (mappedValue !== undefined) {
      result[target] = mappedValue
    }
  }

  return result
}

/**
 * @public
 */
export function applyIntegrationSlotReverseBinding (
  values: Record<string, unknown>,
  binding: IntegrationSlotBinding
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [slot, target] of Object.entries(binding.bindings)) {
    const value = values[target]
    const mappedValue = applyIntegrationValueReverseMapping(value, binding.valueMappings?.[slot])
    if (mappedValue !== undefined) {
      result[slot] = mappedValue
    }
  }

  return result
}

function applyIntegrationValueMapping (value: unknown, mapping: IntegrationValueMapping | undefined): unknown {
  if (value == null) return undefined
  if (mapping?.mode === 'ignore') return undefined
  if (mapping?.mode !== 'map') return value

  if (Array.isArray(value)) {
    const mappedValues = value
      .map((item) => mapIntegrationValue(item, mapping.values))
      .filter((item): item is string => item !== undefined)
    return mappedValues.length > 0 ? mappedValues : undefined
  }

  return mapIntegrationValue(value, mapping.values)
}

function applyIntegrationValueReverseMapping (value: unknown, mapping: IntegrationValueMapping | undefined): unknown {
  if (value == null) return undefined
  if (mapping?.mode === 'ignore') return undefined
  if (mapping?.mode !== 'map') return value

  const reverseValues = getReverseIntegrationValueMapping(mapping.values)
  if (Array.isArray(value)) {
    const mappedValues = value
      .map((item) => mapIntegrationValue(item, reverseValues))
      .filter((item): item is string => item !== undefined)
    return mappedValues.length > 0 ? mappedValues : undefined
  }

  return mapIntegrationValue(value, reverseValues)
}

function mapIntegrationValue (value: unknown, mapping: Record<string, string> | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  return mapping?.[value]
}

function getReverseIntegrationValueMapping (
  mapping: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (mapping === undefined) return undefined

  const result: Record<string, string> = {}
  for (const [external, internal] of Object.entries(mapping)) {
    result[internal] ??= external
  }
  return result
}

/**
 * @public
 */
export async function createIntegrationTarget (
  ctx: IntegrationTargetContext,
  target: IntegrationRoutingTarget,
  values: Record<string, unknown>
): Promise<Doc> {
  const factory = await findIntegrationTargetFactory(ctx.client, target.targetClass)
  if (factory === undefined) {
    throw new Error(`Integration target factory is not registered for target class ${target.targetClass}`)
  }

  if (factory.canCreate !== undefined) {
    const canCreate = await getResource(factory.canCreate)
    if (!(await canCreate(ctx, target))) {
      throw new Error(`Integration target factory cannot create target class ${target.targetClass}`)
    }
  }

  const create = await getResource(factory.create)
  return await create(ctx, target, values)
}

/**
 * @public
 */
export async function updateIntegrationTarget (
  ctx: IntegrationTargetContext,
  doc: Doc,
  values: Record<string, unknown>
): Promise<void> {
  const factory = await findIntegrationTargetFactory(ctx.client, doc._class)
  if (factory?.update === undefined) {
    throw new Error(`Integration target factory update is not registered for target class ${doc._class}`)
  }

  const update = await getResource(factory.update)
  await update(ctx, doc, values)
}

/**
 * @public
 */
export async function getIntegrationTargetCommentBackend (
  ctx: IntegrationTargetContext,
  doc: Doc
): Promise<IntegrationTargetCommentBackend> {
  const factory = await findIntegrationTargetFactory(ctx.client, doc._class)
  if (factory?.getCommentBackend === undefined) {
    return 'chunter'
  }

  const getCommentBackend = await getResource(factory.getCommentBackend)
  return await getCommentBackend(ctx, doc)
}

/**
 * @public
 */
export async function resolveIntegrationValues (
  client: Client,
  provider: Ref<IntegrationSlotProvider>,
  values: Record<string, unknown>,
  context: IntegrationTargetContext,
  resolverContext: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const resolvers = await client.findAll(integration.class.IntegrationValueResolver, { provider })
  const resolverBySlot = new Map<string, IntegrationValueResolver>(
    resolvers.map((resolver) => [resolver.slot, resolver])
  )
  const result: Record<string, unknown> = { ...values }

  for (const [slot, value] of Object.entries(values)) {
    const resolverDoc = resolverBySlot.get(slot)
    if (resolverDoc === undefined) {
      continue
    }

    const resolver = await getResource(resolverDoc.resolver)
    result[slot] = await resolver(context.integration, value, resolverContext)
  }

  return result
}

/**
 * @public
 */
export async function saveIntegrationSetup (
  client: TxOperations & Client,
  params: SaveIntegrationSetupParams
): Promise<SaveIntegrationSetupResult> {
  let binding = await client.findOne(integration.class.IntegrationSlotBinding, {
    provider: params.provider
  })

  if (binding === undefined) {
    const id = await client.createDoc(integration.class.IntegrationSlotBinding, core.space.Workspace, {
      provider: params.provider,
      targetClass: params.targetClass,
      bindings: params.bindings,
      valueMappings: params.valueMappings
    })
    binding = await client.findOne(integration.class.IntegrationSlotBinding, { _id: id })
  } else {
    await client.update(binding, {
      targetClass: params.targetClass,
      bindings: params.bindings,
      valueMappings: params.valueMappings
    })
    binding = {
      ...binding,
      targetClass: params.targetClass,
      bindings: params.bindings,
      valueMappings: params.valueMappings
    }
  }

  let policy = await client.findOne(integration.class.IntegrationRoutingPolicy, {
    integration: params.integration,
    provider: params.provider
  })

  if (policy === undefined) {
    const id = await client.createDoc(integration.class.IntegrationRoutingPolicy, core.space.Workspace, {
      integration: params.integration,
      provider: params.provider,
      rules: [],
      fallback: params.fallback
    })
    policy = await client.findOne(integration.class.IntegrationRoutingPolicy, { _id: id })
  } else {
    await client.update(policy, { fallback: params.fallback })
    policy = { ...policy, fallback: params.fallback }
  }

  if (binding === undefined || policy === undefined) {
    throw new Error('Failed to save integration setup')
  }

  return { binding, policy }
}
