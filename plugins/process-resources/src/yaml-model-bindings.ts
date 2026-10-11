//
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

import core, { generateId, type Class, type Doc, type Hierarchy, type ModelDb, type Ref } from '@hcengineering/core'
import type { MasterTag } from '@hcengineering/card'
import {
  getAuthoringProcessIdentities,
  remapAuthoringReferences,
  type AuthoringNativeDocument,
  type Process,
  type SlotModel
} from '@hcengineering/process'

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
  hierarchy: Hierarchy
): boolean {
  const owner = (slot.memberOf === undefined ? masterTag : resolveModelSlotReference(slot.memberOf, bindings)) as Ref<
    Class<Doc>
  >
  if (owner.startsWith('__SLOT_')) return false
  const doc = model.findObject(value as Ref<Doc>)
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
  current?: Ref<Process>
): Doc[] {
  const definition = documents.find((doc) => doc._class === 'process:class:Process') as Process
  const native = documents as unknown as AuthoringNativeDocument[]
  const ids = new Map([...getAuthoringProcessIdentities(native)].map((id) => [id, String(generateId())]))
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
  hierarchy: Hierarchy
): { docs: Doc[], bindings: Record<string, string> } {
  const definition = documents.find((doc) => doc._class === 'process:class:Process') as Process
  const ids = new Map<string, string>()
  const used = new Set<string>(['constructor', 'prototype', '__proto__'])
  const name = (value: string, prefix: string): string => {
    const base =
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
  register(definition._id, '', 'process')
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
  for (const id of getAuthoringProcessIdentities(documents as unknown as AuthoringNativeDocument[]))
    {register(id, '', 'request_')}
  const slotNames = new Map<string, string>()
  const bindings: Record<string, string> = {}
  for (const [key, slot] of Object.entries(definition.requiredSlots ?? {})) {
    const bound = definition.bindings?.[key]
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
