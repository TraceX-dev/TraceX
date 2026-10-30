//
// Copyright © 2025 Hardcore Engineering Inc.
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

import core, {
  generateId,
  type AnyAttribute,
  type ArrOf,
  type Class,
  type Doc,
  type EnumOf,
  type Hierarchy,
  type ModelDb,
  type Ref,
  type RefTo,
  type Type
} from '@hcengineering/core'
import type { MasterTag } from '@hcengineering/card'
import { getAuthoringProcessIdentities, remapAuthoringReferences } from './authoring-model'
import type { AuthoringNativeDocument } from './authoring'
import type { AttributeSlotModel, Process, SlotModel } from './index'

/** Resolves slot placeholders or the original values retained in a full model export. */
export function resolveModelSlotReference (
  value: string,
  bindings: Record<string, string>,
  definition?: Process
): string {
  const slot = /^__SLOT_(.+)__$/.exec(value)?.[1]
  if (slot !== undefined && bindings[slot] !== undefined) return bindings[slot]
  for (const [key, original] of Object.entries(definition?.bindings ?? {})) {
    if (original === value && bindings[key] !== undefined) return bindings[key]
  }
  return value
}

/** Checks non-attribute slots through the model, including dependent owners. */
export function matchesModelSlot (
  masterTag: Ref<MasterTag>,
  slot: SlotModel,
  value: string,
  bindings: Record<string, string>,
  model: ModelDb,
  hierarchy: Hierarchy,
  documents: readonly Doc[] = []
): boolean {
  const owner = (slot.memberOf === undefined ? masterTag : resolveModelSlotReference(slot.memberOf, bindings)) as Ref<
    Class<Doc>
  >
  if (owner.startsWith('__SLOT_')) return false
  const doc = documents.find((doc) => doc._id === value) ?? model.findObject(value as Ref<Doc>)
  const derived = (actual: Ref<Class<Doc>>, expected: Ref<Class<Doc>>): boolean =>
    actual === expected || hierarchy.isDerived(actual, expected)
  if (slot.slotKind === 'unknown') return doc !== undefined || hierarchy.findAttribute(owner, value) !== undefined
  if (doc === undefined || !derived(doc._class, slot._class)) return false
  if (slot.slotKind === 'process') return derived(owner, (doc as Process).masterTag)
  if (slot.slotKind === 'association') {
    const assoc = doc as unknown as { classA: Ref<Class<Doc>>, classB: Ref<Class<Doc>> }
    return (
      (derived(masterTag, assoc.classA) && derived(owner, assoc.classB)) ||
      (derived(masterTag, assoc.classB) && derived(owner, assoc.classA))
    )
  }
  return slot.slotKind === 'class'
}

/** Rebinds every native process operation without an operation-specific converter. */
export function bindYamlModelProcess (
  documents: readonly Doc[],
  masterTag: Ref<MasterTag>,
  bindings: Record<string, string>,
  model: ModelDb,
  hierarchy: Hierarchy,
  current?: Ref<Process>,
  packageIdentities?: ReadonlyMap<string, string>
): Doc[] {
  const definition = documents.find((doc) => doc._class === 'process:class:Process') as Process
  const native = documents as unknown as AuthoringNativeDocument[]
  const ids = new Map([...getAuthoringProcessIdentities(native)].map((id) => [id, String(generateId())]))
  for (const [id, local] of packageIdentities ?? []) ids.set(id, local)
  ids.set(definition._id, current ?? generateId())
  ids.set('__MASTER_TAG__', masterTag)
  if (!definition.masterTag.startsWith('__SLOT_')) ids.set(definition.masterTag, masterTag)
  for (const [key, value] of Object.entries(bindings)) {
    ids.set(`__SLOT_${key}__`, value)
    const original = definition.bindings?.[key]
    if (original !== undefined) ids.set(original, value)
  }
  const result = remapAuthoringReferences(
    native,
    ids,
    modelProcessLiteralCheck(documents, model, hierarchy, masterTag, bindings)
  ) as unknown as Doc[]
  const proc = result.find((doc) => doc._class === 'process:class:Process') as Process
  proc.masterTag = masterTag
  proc.bindings = bindings
  delete proc.requiredSlots
  return result
}

function modelProcessLiteralCheck (
  documents: readonly Doc[],
  model: ModelDb,
  hierarchy: Hierarchy,
  destination?: Ref<MasterTag>,
  bindings?: Record<string, string>
): (doc: AuthoringNativeDocument, path: readonly string[]) => boolean {
  const definition = documents.find((doc) => doc._class === 'process:class:Process') as Process
  return (doc: AuthoringNativeDocument, path: readonly string[]): boolean => {
    let owner = (destination ?? definition.masterTag) as Ref<Class<Doc>>
    let field: string | undefined
    if (doc._class === 'process:class:Transition' && path[0] === 'actions' && path[2] === 'params') {
      const action = (
        doc.actions as Array<{
          methodId: string
          context?: { _class?: Ref<Class<Doc>> }
          params: Record<string, unknown>
        }>
      )[Number(path[1])]
      const method = model.findObject(action.methodId as Ref<Doc>) as unknown as
        { objectClass?: Ref<Class<Doc>> } | undefined
      owner =
        action.context?._class ??
        (action.methodId === 'process:method:UpdateCard' ? owner : (method?.objectClass ?? owner))
      field = path[3]
    } else if (doc._class === 'process:class:Transition' && path[0] === 'triggerParams') field = path[1]
    if (field === undefined || field.startsWith('$')) return false
    const slotKey =
      /^__SLOT_(.+)__$/.exec(field)?.[1] ??
      Object.entries(definition.bindings ?? {}).find(([, value]) => value === field)?.[0]
    const slot = slotKey === undefined ? undefined : definition.requiredSlots?.[slotKey]
    if (slot?.slotKind === 'attribute') {
      const type = (slot as SlotModel & { type: { _class: string } }).type
      return [String(core.class.TypeString), String(core.class.TypeMarkup), String(core.class.EnumOf)].includes(
        type._class
      )
    }
    const originalField = resolveModelSlotReference(field, definition.bindings ?? {})
    const currentBindings = bindings ?? definition.bindings ?? {}
    const resolvedOwner = resolveModelSlotReference(owner, currentBindings, definition) as Ref<Class<Doc>>
    const attribute = hierarchy.findAttribute(
      resolvedOwner,
      resolveModelSlotReference(originalField, currentBindings, definition)
    )
    return (
      attribute !== undefined &&
      [core.class.TypeString, core.class.TypeMarkup, core.class.EnumOf].includes(attribute.type._class)
    )
  }
}

/** Uses readable graph identities and named slots while retaining the existing workspace bindings. */
export function createYamlModelTemplate (
  documents: readonly Doc[],
  model: ModelDb,
  hierarchy: Hierarchy,
  packageProcesses?: ReadonlyMap<string, string>
): { docs: Doc[], bindings: Record<string, string> } {
  const definition = documents.find((doc) => doc._class === 'process:class:Process') as Process
  const ids = new Map<string, string>()
  const used = new Set<string>(['constructor', 'prototype', '__proto__'])
  const name = (value: string, prefix: string): string => {
    const base =
      (packageProcesses === undefined
        ? ''
        : `p_${(packageProcesses.get(definition._id) ?? definition._id).replace(/[^a-zA-Z0-9_]/g, '_')}_`) +
      prefix +
      value
        .replace(/^embedded:embedded:/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+$/, '')
    let result = base || prefix + 'item'
    let counter = 2
    while (used.has(result)) result = `${base}_${counter++}`
    used.add(result)
    return result
  }
  const register = (id: string, label: string, prefix: string): void => {
    if (!ids.has(id)) ids.set(id, name(label, prefix))
  }
  const packageIdentity = packageProcesses?.get(definition._id)
  if (packageIdentity === undefined) register(definition._id, '', 'process')
  else ids.set(definition._id, packageIdentity)
  if (packageProcesses !== undefined) ids.set(definition.masterTag, '__MASTER_TAG__')
  for (const doc of documents) {
    const data = doc as unknown as Record<string, unknown>
    if (doc._class === 'process:class:State') register(doc._id, String(data.title), 'state_')
  }
  for (const doc of documents) {
    if (doc._class !== 'process:class:Transition') continue
    const data = doc as unknown as {
      from: string | null
      to: string
      actions: Array<{ _id: string, methodId: string }>
    }
    register(doc._id, data.from === null ? 'start' : `${ids.get(data.from)}_to_${ids.get(data.to)}`, 'transition_')
    for (const action of data.actions) register(action._id, action.methodId.split(':').at(-1) ?? 'step', 'action_')
  }
  for (const [key, context] of Object.entries(definition.context)) {
    register(key, context.name || String(context._class).split(':').at(-1) || 'result', 'context_')
  }
  for (const id of getAuthoringProcessIdentities(documents as unknown as AuthoringNativeDocument[])) {
    register(id, '', 'request_')
  }
  const slotNames = new Map<string, string>()
  const bindings: Record<string, string> = {}
  for (const [key, slot] of Object.entries(definition.requiredSlots ?? {})) {
    const bound = definition.bindings?.[key]
    const bundledProcess = slot.slotKind === 'process' && bound !== undefined ? packageProcesses?.get(bound) : undefined
    if (bundledProcess !== undefined) {
      const alias = name(slot.label ?? slot.name ?? key, 'slot_')
      slotNames.set(key, alias)
      ids.set(`__SLOT_${key}__`, bundledProcess)
      ids.set(bound as string, bundledProcess)
      bindings[alias] = bundledProcess
      continue
    }
    if (
      slot.slotKind !== 'attribute' &&
      bound !== undefined &&
      /^[a-z][\w-]*:[a-zA-Z][\w-]*:[a-zA-Z][\w-]*$/.test(bound)
    ) {
      ids.set(`__SLOT_${key}__`, bound)
      continue
    }
    if (slot.slotKind === 'attribute' && bound !== undefined) {
      const owner = resolveModelSlotReference(slot.memberOf ?? definition.masterTag, definition.bindings ?? {}) as Ref<
        Class<Doc>
      >
      const attribute = hierarchy.findAttribute(owner, bound)
      if (attribute !== undefined && /^[a-z][\w-]*:class:[a-zA-Z][\w-]*$/.test(attribute.attributeOf)) {
        ids.set(`__SLOT_${key}__`, bound)
        continue
      }
    }
    const alias = name(slot.label ?? slot.name ?? key, 'slot_')
    slotNames.set(key, alias)
    ids.set(`__SLOT_${key}__`, `__SLOT_${alias}__`)
    if (bound !== undefined) {
      ids.set(bound, `__SLOT_${alias}__`)
      bindings[alias] = bound
    }
  }
  const docs = remapAuthoringReferences(
    documents as unknown as AuthoringNativeDocument[],
    ids,
    modelProcessLiteralCheck(documents, model, hierarchy)
  ) as unknown as Doc[]
  const proc = docs.find((doc) => doc._class === 'process:class:Process') as Process
  proc.requiredSlots = Object.fromEntries(
    Object.entries(proc.requiredSlots ?? {})
      .filter(([key]) => slotNames.has(key))
      .map(([key, value]) => [slotNames.get(key) as string, value])
  )
  proc.bindings = bindings
  return { docs, bindings }
}

/** Shared compatibility check for apply validation and editor binding prefills. */
export function isAuthoringSlotBindingCompatible (
  masterTag: Ref<MasterTag>,
  slot: SlotModel,
  bound: string,
  bindings: Record<string, string>,
  model: ModelDb,
  hierarchy: Hierarchy,
  definition?: Process,
  documents: readonly Doc[] = []
): boolean {
  if (slot.slotKind !== 'attribute') {
    return matchesModelSlot(masterTag, slot, bound, bindings, model, hierarchy, documents)
  }
  const owner = (
    slot.memberOf === undefined ? masterTag : resolveModelSlotReference(slot.memberOf, bindings, definition)
  ) as Ref<Class<Doc>>
  if (owner.startsWith('__SLOT_')) return false
  const attribute = hierarchy.findAttribute(owner, bound)
  if (attribute === undefined) return false
  const requirement = slot as AttributeSlotModel
  const resolveType = (type: Type<unknown>): Type<unknown> => {
    const result: Type<unknown> & { to?: string, of?: string | Type<unknown> } = { ...type }
    if (result.to !== undefined) result.to = resolveModelSlotReference(result.to, bindings, definition)
    if (typeof result.of === 'object') result.of = resolveType(result.of)
    return result
  }
  const expected = resolveType(requirement.type)
  let enumType = expected
  while (enumType._class === core.class.ArrOf) enumType = (enumType as ArrOf<Doc>).of
  const enumeration =
    enumType._class === core.class.EnumOf
      ? (documents.find((doc) => doc._id === (enumType as EnumOf).of) ?? model.findObject((enumType as EnumOf).of))
      : undefined
  const choices =
    requirement.enumValues ?? (enumeration as unknown as { enumValues?: string[] } | undefined)?.enumValues
  return matchesAuthoringSlotType(expected, attribute.type, choices, model)
}

/** Matches choice values semantically rather than comparing workspace-specific enum ids. */
export function matchesAuthoringSlotType (
  expected: Type<unknown>,
  actual: Type<unknown>,
  choices: string[] | undefined,
  model: ModelDb
): boolean {
  if (expected._class !== actual._class) return false
  if (expected._class === core.class.ArrOf) {
    return matchesAuthoringSlotType((expected as ArrOf<Doc>).of, (actual as ArrOf<Doc>).of, choices, model)
  }
  if (expected._class === core.class.RefTo) return (expected as RefTo<Doc>).to === (actual as RefTo<Doc>).to
  if (expected._class === core.class.EnumOf && choices !== undefined) {
    const enumeration = model.findObject((actual as EnumOf).of)
    return (
      enumeration !== undefined &&
      enumeration.enumValues.length === choices.length &&
      choices.every((choice) => enumeration.enumValues.includes(choice))
    )
  }
  return true
}

/** Copies full modules for the editor's Create new action; file imports retain native JSON identity semantics. */
export function cloneAuthoringModule (
  documents: Doc[],
  model: ModelDb,
  hierarchy: Hierarchy,
  identities?: ReadonlyMap<string, string>
): Doc[] {
  const mapping = new Map(identities ?? documents.map((doc) => [String(doc._id), String(generateId())]))
  for (const id of getAuthoringProcessIdentities(documents as unknown as AuthoringNativeDocument[])) {
    if (!mapping.has(id)) mapping.set(id, generateId())
  }
  const attributes = documents.filter((doc) => doc._class === core.class.Attribute) as AnyAttribute[]
  const literal = (doc: AuthoringNativeDocument, path: readonly string[]): boolean => {
    let owner = doc._class
    let key = path[0]
    if (doc._class === 'process:class:Transition') {
      const proc = documents.find((item) => item._id === doc.process) as unknown as { masterTag: string }
      owner = proc.masterTag
      if (path[0] === 'actions' && path[2] === 'params') {
        const action = (doc.actions as Array<{ methodId: string, context?: { _class?: string } }>)[Number(path[1])]
        const method = model.findObject(action.methodId as Ref<Doc>) as unknown as { objectClass?: string } | undefined
        owner =
          action.context?._class ??
          (action.methodId === 'process:method:UpdateCard' ? owner : (method?.objectClass ?? owner))
        key = path[3]
      } else if (path[0] === 'triggerParams') key = path[1]
      else return false
    }
    const visited = new Set<string>()
    let attribute: AnyAttribute | undefined
    while (!visited.has(owner)) {
      visited.add(owner)
      attribute = attributes.find((attr) => attr.attributeOf === owner && attr.name === key)
      if (attribute !== undefined) break
      const local = documents.find((item) => item._id === owner) as unknown as { extends?: string } | undefined
      if (local?.extends !== undefined) owner = local.extends
      else {
        attribute = hierarchy.findAttribute(owner as Ref<Class<Doc>>, key)
        break
      }
    }
    return (
      attribute !== undefined &&
      [core.class.TypeString, core.class.TypeMarkup, core.class.EnumOf].includes(attribute.type._class)
    )
  }
  return remapAuthoringReferences(
    documents as unknown as AuthoringNativeDocument[],
    mapping,
    literal
  ) as unknown as Doc[]
}
