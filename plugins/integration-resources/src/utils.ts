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

import core, {
  type AnyAttribute,
  type Class,
  type Client,
  type Doc,
  type EnumOf,
  type Ref,
  type RefTo,
  type Space,
  type Status,
  type Type
} from '@hcengineering/core'
import integration, {
  type IntegrationAttributeSlotModel,
  type IntegrationSlotModel,
  type IntegrationTargetFactory,
  type IntegrationValueOption
} from '@hcengineering/integration'
import { getEmbeddedLabel, getResource, type IntlString } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'

export interface IntegrationSelectOption {
  id: string
  label?: IntlString
  text?: string
}

type TypeWithReference = Type<unknown> & {
  to?: Ref<Class<Doc>>
  of?: Ref<Doc> | Type<unknown>
}

export function isClassLike (client: Client, obj: Doc | undefined): boolean {
  if (obj === undefined) return false
  return client.getHierarchy().isDerived(obj._class, core.class.Class)
}

function getTypeReference (type: Type<unknown>): Ref<Class<Doc>> | Ref<Doc> | Type<unknown> | undefined {
  const typed = type as TypeWithReference
  return typed.to ?? typed.of
}

function isAttributeSlot (slot: IntegrationSlotModel): slot is IntegrationAttributeSlotModel {
  return slot.slotKind === 'attribute'
}

function isStatusRefAttribute (client: Client, attr: AnyAttribute): boolean {
  try {
    return (
      attr.type._class === core.class.RefTo &&
      client.getHierarchy().isDerived((attr.type as RefTo<Status>).to, core.class.Status)
    )
  } catch (e) {
    return false
  }
}

export function isTypeEqual (
  client: Client,
  slotType: Type<unknown> | undefined,
  attrType: Type<unknown> | undefined
): boolean {
  if (slotType === undefined || attrType === undefined) return false
  if (slotType._class !== attrType._class) return false

  const slotRef = getTypeReference(slotType)
  const attrRef = getTypeReference(attrType)
  if (slotRef !== undefined || attrRef !== undefined) {
    if (slotType._class === core.class.RefTo && typeof slotRef === 'string' && typeof attrRef === 'string') {
      return (
        attrRef === slotRef || client.getHierarchy().isDerived(attrRef as Ref<Class<Doc>>, slotRef as Ref<Class<Doc>>)
      )
    }
    return slotRef === attrRef
  }

  return true
}

function getSlotTypes (slot: IntegrationSlotModel): Array<Type<unknown>> {
  if (!isAttributeSlot(slot)) return []
  return slot.types ?? [slot.type]
}

export function getTargetClassOptions (
  client: Client,
  targetClasses: Array<Ref<Class<Doc>>> | undefined = undefined
): IntegrationSelectOption[] {
  const hierarchy = client.getHierarchy()
  const targetClassSet = new Set<Ref<Class<Doc>>>()
  const addTargetClass = (targetClass: Ref<Class<Doc>>): void => {
    targetClassSet.add(targetClass)
    try {
      for (const descendant of hierarchy.getDescendants(targetClass)) {
        targetClassSet.add(descendant as Ref<Class<Doc>>)
      }
    } catch (e) {}
  }

  const factories: Array<Pick<IntegrationTargetFactory, 'targetClass'>> =
    targetClasses !== undefined
      ? targetClasses.map((targetClass) => ({ targetClass }))
      : client.getModel().findAllSync(integration.class.IntegrationTargetFactory, {})

  for (const factory of factories) {
    addTargetClass(factory.targetClass)
  }

  return Array.from(targetClassSet)
    .map((targetClass) => {
      try {
        const cls = hierarchy.getClass(targetClass)
        return {
          id: targetClass,
          label: cls.label,
          text: targetClass
        }
      } catch (e) {
        return {
          id: targetClass,
          text: targetClass
        }
      }
    })
    .sort((a: IntegrationSelectOption, b: IntegrationSelectOption) => (a.text ?? a.id).localeCompare(b.text ?? b.id))
}

export function getTargetClassLabel (client: Client, targetClass: Ref<Class<Doc>>): IntlString {
  return client.getHierarchy().getClass(targetClass).label
}

export async function getAllowedSpaceClasses (
  client: Client,
  targetClass: Ref<Class<Doc>> | undefined
): Promise<Array<Ref<Class<Space>>>> {
  if (targetClass === undefined) return []

  const hierarchy = client.getHierarchy()
  const factory = findTargetFactory(client, targetClass)
  if (factory?.getAllowedSpaceClasses === undefined) return []

  let resolved: Array<Ref<Class<Space>>>
  try {
    const resolver = await getResource(factory.getAllowedSpaceClasses)
    resolved = await resolver(client, targetClass)
  } catch (e) {
    return []
  }

  const result = new Set<Ref<Class<Space>>>()
  for (const spaceClass of resolved) {
    result.add(spaceClass)
    try {
      for (const descendant of hierarchy.getDescendants(spaceClass)) {
        result.add(descendant as Ref<Class<Space>>)
      }
    } catch (e) {}
  }

  return Array.from(result)
}

function findTargetFactory (client: Client, targetClass: Ref<Class<Doc>>): IntegrationTargetFactory | undefined {
  const hierarchy = client.getHierarchy()
  const factories = client.getModel().findAllSync(integration.class.IntegrationTargetFactory, {})
  const candidates = factories.filter((factory) => {
    try {
      return factory.targetClass === targetClass || hierarchy.isDerived(targetClass, factory.targetClass)
    } catch (e) {
      return false
    }
  })
  candidates.sort((a, b) => {
    return hierarchy.getAncestors(b.targetClass).length - hierarchy.getAncestors(a.targetClass).length
  })
  return candidates[0]
}

export function getPossibleAttributes (
  client: Client,
  allAttrs: Map<string, AnyAttribute>,
  slot: IntegrationSlotModel
): IntegrationSelectOption[] {
  return Array.from(allAttrs.values())
    .filter((attr) => {
      if (attr.hidden ?? false) return false
      if (getSlotTypes(slot).some((slotType) => isTypeEqual(client, slotType, attr.type))) return true
      return (
        (slot.values?.length ?? 0) > 0 && (attr.type._class === core.class.EnumOf || isStatusRefAttribute(client, attr))
      )
    })
    .map((attr) => ({
      id: attr.name,
      label: attr.label,
      text: attr.name
    }))
}

export function getTargetAttributeValueOptions (
  client: Client,
  allAttrs: Map<string, AnyAttribute>,
  attributeName: string | undefined,
  _space?: Ref<Space>
): IntegrationValueOption[] {
  if (attributeName === undefined) return []

  const attr = allAttrs.get(attributeName)
  if (attr?.type._class === core.class.EnumOf) {
    const enumId = (attr.type as EnumOf).of
    const enumDoc = client.getModel().findObject(enumId)
    return (
      enumDoc?.enumValues.map((value) => ({
        value,
        label: getEmbeddedLabel(value)
      })) ?? []
    )
  }

  if (attr !== undefined && isStatusRefAttribute(client, attr)) {
    const statusClass = (attr.type as RefTo<Status>).to
    return client
      .getModel()
      .findAllSync<Status>(statusClass, { ofAttribute: attr._id })
      .map((status) => ({
        value: status._id,
        label: getEmbeddedLabel(status.name)
      }))
  }

  return []
}

export function getPossibleClasses (client: Client, slot: IntegrationSlotModel): IntegrationSelectOption[] {
  const hierarchy = client.getHierarchy()
  let descendants: Array<Ref<Class<Doc>>> = []
  try {
    descendants = hierarchy.getDescendants(core.class.Obj) as Array<Ref<Class<Doc>>>
  } catch (e) {}

  return descendants
    .map((id) => {
      try {
        return hierarchy.getClass(id)
      } catch (e) {
        return undefined
      }
    })
    .filter((cls): cls is Class<Doc> => cls !== undefined && !(cls.hidden ?? false))
    .filter((cls) => {
      return cls._id === slot._class || hierarchy.isDerived(cls._id, slot._class)
    })
    .map((cls) => ({
      id: cls._id,
      label: cls.label,
      text: cls._id
    }))
}

export function getBindingLabel (
  client: Client,
  allAttrs: Map<string, AnyAttribute>,
  bindings: Record<string, string>,
  id: string
): IntlString {
  const value = bindings[id]
  if (value === undefined) return presentation.string.NotSelected

  const attr = Array.from(allAttrs.values()).find((a) => a.name === value)
  if (attr !== undefined) return attr.label ?? getEmbeddedLabel(attr.name)

  const cls = client.getModel().findObject(value as Ref<Class<Doc>>)
  if (isClassLike(client, cls)) return cls?.label ?? getEmbeddedLabel(value)

  return getEmbeddedLabel(value)
}
