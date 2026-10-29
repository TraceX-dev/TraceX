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

import card, { type MasterTag } from '@hcengineering/card'
import core, {
  type AnyAttribute,
  type ArrOf,
  type Association,
  type Attribute,
  type Class,
  type Doc,
  type EnumOf,
  generateId,
  type Hierarchy,
  type ModelDb,
  type Ref,
  type RefTo,
  type Type
} from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import {
  getDefinitionPackageInfo,
  stripDefinitionPackageInfo,
  type DefinitionPackageOwner
} from '@hcengineering/marketplace'
import {
  compileProcessYaml,
  bindYamlModelProcess,
  createYamlModelTemplate,
  isAuthoringSlotBindingCompatible,
  matchesAuthoringSlotType,
  exportAuthoringModel,
  getAuthoringCatalog,
  parseProcessImport,
  validateAuthoringModelOperations,
  type AttributeSlotModel,
  type AuthoringNativeDocument,
  type Process,
  type SlotModel,
  type Transition
} from '@hcengineering/process'
import { deepEqual } from 'fast-equals'
import processPlugin from './plugin'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExportResult {
  docs: Doc[]
  required: Array<Ref<Class<Doc>>>
}

export type { AttributeSlotModel, SlotModel }

type DetailedSlotModel = AttributeSlotModel | SlotModel

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalizes a dot-separated platform ID to colon-separated form. */
const normalizeId = (id: string | undefined): string | undefined => id?.replace(/\./g, ':')

/** Checks if a normalized ID belongs to a system namespace (core or process). */
function isSystemId (id: string): boolean {
  return id.startsWith('core:class:') || id.startsWith('process:class:')
}

function stripData<T extends Doc> (
  doc: T
): Omit<T, '_id' | '_class' | 'space' | 'modifiedBy' | 'modifiedOn' | 'createdBy' | 'createdOn'> {
  const { _id, _class, space, modifiedBy, modifiedOn, createdBy, createdOn, ...rest } = doc
  return rest
}

// ─── Slot Factories ──────────────────────────────────────────────────────────

function attributeToSlot (attr: AnyAttribute, memberOf?: string): AttributeSlotModel {
  return {
    slotKind: 'attribute',
    _class: attr._class,
    label: attr.label,
    name: attr.name,
    memberOf,
    type: attr.type
  }
}

function classToSlot (cls: Class<any>, memberOf?: string): SlotModel {
  return {
    slotKind: 'class',
    _class: cls._class,
    label: cls.label,
    memberOf
  }
}

function associationToSlot (assoc: Association, direction: string | undefined, memberOf?: string): SlotModel {
  let name = (assoc as any).name ?? assoc.nameA
  if (direction === 'B') name = assoc.nameB
  else if (direction === 'A') name = assoc.nameA
  return {
    slotKind: 'association',
    _class: assoc._class,
    label: (assoc as any).label,
    name,
    memberOf
  }
}

function processToSlot (proc: Process, memberOf?: string): SlotModel {
  return {
    slotKind: 'process',
    _class: proc._class,
    label: (proc as any).label,
    name: proc.name,
    memberOf
  }
}

function unknownToSlot (id: string, memberOf?: string): SlotModel {
  return {
    slotKind: 'unknown',
    _class: core.class.Obj,
    label: id as any,
    name: id,
    memberOf
  }
}

// ─── Type & Param Processing ─────────────────────────────────────────────────

/** Collects type-level dependencies: enum docs and required Card-derived classes. */
function processType (type: Type<any>, docs: Doc[], required: Array<Ref<Class<Doc>>>, m: ModelDb, h: Hierarchy): void {
  if (type._class === core.class.EnumOf) {
    const enumRef = (type as EnumOf).of
    const enumDoc = m.findObject(enumRef)
    if (enumDoc !== undefined && !docs.some((d) => d._id === enumDoc._id)) {
      docs.push(enumDoc)
    }
  }
  if (type._class === core.class.RefTo) {
    const to = (type as RefTo<Doc>).to
    if (h.isDerived(to, card.class.Card) && !required.includes(to)) {
      required.push(to)
    }
  }
  if (type._class === core.class.ArrOf) {
    processType((type as ArrOf<Doc>).of, docs, required, m, h)
  }
}

/** Recursively scans action/trigger params for type dependencies. */
function processParams (
  params: Record<string, any> | undefined,
  masterTag: Ref<MasterTag>,
  docs: Doc[],
  required: Array<Ref<Class<Doc>>>,
  m: ModelDb,
  h: Hierarchy
): void {
  if (params === undefined) return
  for (const key in params) {
    if (key.startsWith('$')) {
      const val = params[key]
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'object' && item !== null) {
            processParams(item, masterTag, docs, required, m, h)
          }
        }
      } else if (typeof val === 'object' && val !== null) {
        processParams(val, masterTag, docs, required, m, h)
      }
      continue
    }
    const attr = h.findAttribute(masterTag, key)
    if (attr !== undefined) {
      processType(attr.type, docs, required, m, h)
    }
    // Also scan values for DSL
    const val = params[key]
    if (typeof val === 'string') {
      scanDSL(val, masterTag, docs, required, m, h)
    }
  }
}

/** Scans DSL expressions for attribute and object references. */
function scanDSL (
  dsl: string,
  masterTag: Ref<MasterTag>,
  docs: Doc[],
  required: Array<Ref<Class<Doc>>>,
  model: ModelDb,
  h: Hierarchy
): void {
  // Detect @attr references
  for (const m of dsl.matchAll(/\$\{@([a-zA-Z0-9_]+)/g)) {
    const attr = h.findAttribute(masterTag, m[1])
    if (attr !== undefined) processType(attr.type, docs, required, model, h)
  }
  // Detect inline 24-char hex IDs
  for (const match of dsl.matchAll(/[0-9a-fA-F]{24}/g)) {
    const obj = h.findAttribute(masterTag, match[0]) ?? model.findObject(match[0] as any)
    if ((obj as any)?.type !== undefined) {
      processType((obj as any).type, docs, required, model, h)
    }
  }
}

// ─── Export API ───────────────────────────────────────────────────────────────

/** Exports all processes associated with a MasterTag. */
export function exportProcesses (_id: Ref<MasterTag>): ExportResult {
  const docs: Doc[] = []
  const required: Array<Ref<Class<Doc>>> = []
  const client = getClient()
  const m = client.getModel()
  const processes = m.findAllSync(processPlugin.class.Process, { masterTag: _id })
  for (const proc of processes) {
    const res = exportProcess(proc, false)
    docs.push(...res.docs)
    for (const req of res.required) {
      if (!required.includes(req)) required.push(req)
    }
  }
  return { docs, required }
}

/**
 * Exports a single process into a portable template.
 *
 * Collects the process doc, its states, transitions, and all type dependencies.
 * Detects environment-specific references and replaces them with named slots.
 * Returns normalized docs where all IDs are replaced with placeholders.
 */
export function exportProcess (proc: Process, withSlots: boolean = true): ExportResult {
  const portable = stripDefinitionPackageInfo(proc)
  const docs: Doc[] = [portable]
  const required: Array<Ref<Class<Doc>>> = []
  const client = getClient()
  const m = client.getModel()
  const h = client.getHierarchy()

  // Collect states and transitions
  docs.push(...m.findAllSync(processPlugin.class.State, { process: proc._id }))
  const transitions = m.findAllSync(processPlugin.class.Transition, { process: proc._id })
  docs.push(...transitions)

  // Process type dependencies from transitions
  for (const tr of transitions) {
    processParams(tr.triggerParams, proc.masterTag, docs, required, m, h)
    for (const action of tr.actions) {
      processParams(action.params, proc.masterTag, docs, required, m, h)
      if (action.results !== undefined) {
        for (const res of action.results) {
          processType(res.type, docs, required, m, h)
        }
      }
    }
  }

  // Process type dependencies from context
  if (proc.context !== undefined) {
    for (const key in proc.context) {
      const ctx = proc.context[key as any]
      if (ctx.type !== undefined) {
        processType(ctx.type, docs, required, m, h)
      }
    }
  }

  if (proc.resultType !== undefined) {
    processType(proc.resultType, docs, required, m, h)
  }

  if (withSlots) {
    // Detect slots and bindings
    const requiredSlots: Record<string, SlotModel> = {}
    const bindings: Record<string, string> = {}
    detectSlots(proc, transitions, requiredSlots, bindings, m, h)

    // Attach slots/bindings to the process doc for serialization
    const clonedProc = { ...portable, requiredSlots, bindings }
    const docIndex = docs.findIndex((d) => d._id === proc._id)
    if (docIndex !== -1) docs[docIndex] = clonedProc

    // Process type dependencies from detected slots
    for (const slotId in requiredSlots) {
      const slot = requiredSlots[slotId]
      if (slot.slotKind === 'attribute' && (slot as AttributeSlotModel).type != null) {
        processType((slot as AttributeSlotModel).type, docs, required, m, h)
      } else if (slot.slotKind === 'class' || slot.slotKind === 'process') {
        if (h.isDerived(slot._class, card.class.Card) && !required.includes(slot._class)) {
          required.push(slot._class)
        }
      }
    }
  } else {
    const { requiredSlots, bindings, ...restProc } = portable
    const docIndex = docs.findIndex((d) => d._id === proc._id)
    if (docIndex !== -1) docs[docIndex] = restProc
  }

  return { docs: withSlots ? normalizeIds(docs) : docs, required }
}

// ─── Import API ──────────────────────────────────────────────────────────────

/** Serializes a native JSON export or a portable YAML DSL without changing JSON slot behavior. */
export function exportProcessSource (proc: Process, format: 'json' | 'yaml', withSlots: boolean = true): string {
  if (format === 'json') {
    return JSON.stringify(
      exportProcess(proc, withSlots).docs.map((doc) => {
        const { modifiedBy, modifiedOn, createdBy, createdOn, ...rest } = doc
        return rest
      })
    )
  }
  return exportProcessDraft(proc).source
}

/** Exports a YAML draft with resolved bindings for editing or duplicating a process. */
export function exportProcessDraft (proc: Process): { source: string, bindings: Record<string, string> } {
  const template = processYamlTemplate(proc)
  return {
    source: exportAuthoringModel(template.docs, 'process', getAuthoringCatalog(getClient().getModel())),
    bindings: template.bindings
  }
}

/** Exports a complete process set, retaining member identities and binding internal process references. */
export function exportProcessPackageSource (processes: readonly Process[]): string {
  if (processes.length === 0) throw new Error('Select at least one process')
  const identities = new Map(
    processes.map((proc) => [
      String(proc._id),
      (proc as DefinitionPackageOwner).definitionPackageInstallation?.member ?? String(proc._id)
    ])
  )
  if (identities.size !== processes.length) throw new Error('A package cannot contain the same process twice')
  if (new Set(identities.values()).size !== processes.length) throw new Error('Package member identities overlap')
  const docs = new Map<string, Doc>()
  for (const proc of processes) {
    for (const doc of processYamlTemplate(proc, identities).docs) {
      if (doc._class === processPlugin.class.Process) {
        const root = doc as Process
        root.bindings = Object.fromEntries(
          Object.entries(root.bindings ?? {}).filter(([, value]) => [...identities.values()].includes(value))
        )
      }
      const previous = docs.get(doc._id)
      if (previous !== undefined && !deepEqual(previous, doc)) {
        throw new Error(`Conflicting package definition: ${doc._id}`)
      }
      docs.set(doc._id, doc)
    }
  }
  return exportAuthoringModel([...docs.values()], 'process', getAuthoringCatalog(getClient().getModel()))
}

function processYamlTemplate (
  proc: Process,
  packageProcesses?: ReadonlyMap<string, string>
): { docs: Doc[], bindings: Record<string, string> } {
  const { docs, required } = exportProcess(proc, false)
  const client = getClient()
  const model = client.getModel()
  const hierarchy = client.getHierarchy()
  const slots: Record<string, SlotModel> = {}
  const bindings: Record<string, string> = {}
  const transitions = docs.filter((doc) => doc._class === processPlugin.class.Transition) as Transition[]
  detectSlots(proc, transitions, slots, bindings, model, hierarchy, true)
  for (const slot of Object.values(slots)) {
    if (slot.slotKind === 'attribute') {
      const attribute = slot as AttributeSlotModel
      processType(attribute.type, docs, required, model, hierarchy)
      let type = attribute.type
      while (type._class === core.class.ArrOf) type = (type as ArrOf<Doc>).of
      if (type._class === core.class.EnumOf) attribute.enumValues = model.findObject((type as EnumOf).of)?.enumValues
    }
  }
  const portable = docs.map((doc) => (doc._id === proc._id ? { ...doc, requiredSlots: slots, bindings } : doc))
  return createYamlModelTemplate(portable, model, hierarchy, packageProcesses)
}

/** Replaces a process graph from YAML, preserving the process id, owner and ordering. */
export async function updateProcessYaml (
  proc: Process,
  source: string,
  bindings: Record<string, string>
): Promise<void> {
  const compiled = compileProcessYaml(source, getClient().getModel())
  if (compiled.kind !== 'process') throw new Error('kind: Expected a standalone process')
  if (compiled.docs.filter((doc) => doc._class === processPlugin.class.Process).length !== 1) {
    throw new Error('Install process bundles through Marketplace')
  }
  const data = compiled.docs as unknown as Doc[]
  validateYamlBindings(proc.masterTag, data, bindings)
  const client = getClient()
  const model = client.getModel()
  validateAuthoringModelOperations(compiled.docs, model, client.getHierarchy())
  const docs = bindYamlModelProcess(data, proc.masterTag, bindings, model, client.getHierarchy(), proc._id)
  const definition = docs.find((doc) => doc._class === processPlugin.class.Process) as Process | undefined
  if (definition === undefined) throw new Error('process: Missing process definition')
  definition.rank = proc.rank
  definition.bindings = bindings
  const packageInfo = getDefinitionPackageInfo(proc)
  if (packageInfo !== undefined) Reflect.set(definition, 'definitionPackage', packageInfo)
  const installation = (proc as DefinitionPackageOwner).definitionPackageInstallation
  if (installation !== undefined) Reflect.set(definition, 'definitionPackageInstallation', installation)
  delete definition.requiredSlots
  if (model.findObject(proc._id) === undefined) throw new Error('process: The process no longer exists')
  const oldDocs: Doc[] = [
    ...model.findAllSync(processPlugin.class.Transition, { process: proc._id }),
    ...model.findAllSync(processPlugin.class.State, { process: proc._id })
  ]
  const apply = client.apply('Save process YAML')
  for (const doc of oldDocs) await apply.removeDoc(doc._class, doc.space, doc._id)
  const values = stripData(definition)
  const unset = Object.fromEntries(
    Object.keys(stripData(proc))
      .filter((key) => !(key in values))
      .map((key) => [key, true])
  )
  await apply.updateDoc(proc._class, proc.space, proc._id, {
    ...values,
    $unset: {
      ...unset,
      requiredSlots: true,
      ...(definition.automationOnly === undefined ? { automationOnly: true } : {})
    }
  })
  for (const doc of docs) {
    if (doc._id === proc._id) continue
    const existing = model.findObject(doc._id)
    if (existing === undefined) await apply.createDoc(doc._class, doc.space, stripData(doc), doc._id)
    else if (!deepEqual(stripData(doc), stripData(existing))) {
      await apply.updateDoc(doc._class, existing.space, doc._id, stripData(doc))
    }
  }
  const result = await apply.commit(true)
  if (!result.result) throw new Error('process: Saving the process failed')
}

/**
 * Extracts slot requirements from an exported process JSON.
 * Returns the slot definitions if the process has any, for use in binding UI.
 */
export function getRequiredSlots (json: string): Record<string, SlotModel> | undefined {
  try {
    const data = parseProcessImport(
      json,
      'process',
      json.trimStart().startsWith('[') ? undefined : getClient().getModel()
    )
    const proc = data.find((d: any) => d._class === processPlugin.class.Process)
    const slots = (proc as Process | undefined)?.requiredSlots
    if (slots === undefined || json.trimStart().startsWith('[')) return slots
    return Object.fromEntries(
      Object.entries(slots).map(([key, slot]) => {
        if (slot.slotKind !== 'attribute') return [key, slot]
        const attribute = slot as AttributeSlotModel
        let type = attribute.type
        while (type._class === core.class.ArrOf) type = (type as ArrOf<Doc>).of
        const enumeration =
          type._class === core.class.EnumOf ? data.find((doc) => doc._id === (type as EnumOf).of) : undefined
        const values = (enumeration as unknown as { enumValues?: string[] } | undefined)?.enumValues
        return [key, values === undefined ? slot : { ...slot, enumValues: values }]
      })
    )
  } catch (e) {
    if (!json.trimStart().startsWith('[')) throw e
    return undefined
  }
}

/**
 * Imports a process template into the current environment.
 *
 * Denormalizes placeholder IDs back to real IDs, applies slot bindings,
 * and creates all documents (process, states, transitions) in the model.
 */
export async function importProcess (
  masterTag: Ref<MasterTag>,
  json: string,
  bindings?: Record<string, string>
): Promise<void> {
  try {
    const data = parseProcessImport(
      json,
      'process',
      json.trimStart().startsWith('[') ? undefined : getClient().getModel()
    )
    if (data.length === 0) return
    const yaml = !json.trimStart().startsWith('[')
    if (yaml) validateYamlBindings(masterTag, data, bindings ?? {})
    const client = getClient()
    const m = client.getModel()
    if (yaml) {
      validateAuthoringModelOperations(data as unknown as AuthoringNativeDocument[], m, client.getHierarchy())
    }
    const denormalizedData = yaml
      ? bindYamlModelProcess(data, masterTag, bindings ?? {}, m, client.getHierarchy())
      : denormalizeIds(data, masterTag, bindings ?? {})
    const apply = client.apply('Import process')
    for (const elem of denormalizedData) {
      if (elem._class === processPlugin.class.Process) {
        ;(elem as any).masterTag = masterTag
        if (bindings !== undefined) {
          ;(elem as any).bindings = bindings
        }
        // Strip template metadata — slots will be re-detected for the new environment
        delete (elem as any).requiredSlots
      }
      const existing = m.findObject(elem._id)
      if (existing !== undefined) {
        const newData = stripData(elem)
        const oldData = stripData(existing)
        if (!deepEqual(newData, oldData)) {
          await apply.updateDoc(elem._class, existing.space, elem._id, newData)
        }
        continue
      }
      await apply.createDoc(elem._class, core.space.Model, stripData(elem), elem._id)
    }
    const result = await apply.commit(true)
    if (!result?.result) throw new Error('Importing the process failed')
  } catch (e) {
    console.error('Failed to import process:', e)
    throw e
  }
}

/** Checks every YAML slot kind against the destination model before any write. */
function validateYamlBindings (masterTag: Ref<MasterTag>, data: Doc[], bindings: Record<string, string>): void {
  const definition = data.find((doc) => doc._class === processPlugin.class.Process) as Process | undefined
  for (const [key, requirement] of Object.entries(definition?.requiredSlots ?? {})) {
    const bound = bindings[key]
    if (bound === undefined || bound.trim() === '') {
      throw new Error(
        `slots.${key}: A ${requirement.slotKind === 'attribute' ? 'field' : requirement.slotKind} binding is required`
      )
    }
    if (!isYamlSlotBindingCompatible(masterTag, requirement, bound, bindings, definition, data)) {
      throw new Error(`slots.${key}: The binding does not match the declared slot type, owner or choices`)
    }
  }
}

/** Shared compatibility check for apply validation and editor binding prefills. */
export function isYamlSlotBindingCompatible (
  masterTag: Ref<MasterTag>,
  slot: SlotModel,
  bound: string,
  bindings: Record<string, string>,
  definition?: Process,
  documents: readonly Doc[] = []
): boolean {
  const client = getClient()
  return isAuthoringSlotBindingCompatible(
    masterTag,
    slot,
    bound,
    bindings,
    client.getModel(),
    client.getHierarchy(),
    definition,
    documents
  )
}

/** Matches choice values semantically rather than comparing workspace-specific enum ids. */
export function matchesSlotType (
  expected: Type<unknown>,
  actual: Type<unknown>,
  choices: string[] | undefined,
  model: ModelDb
): boolean {
  return matchesAuthoringSlotType(expected, actual, choices, model)
}

// ─── ID Normalization ────────────────────────────────────────────────────────

/**
 * Replaces all environment-specific IDs in exported docs with deterministic placeholders.
 *
 * Uses `__PROCESS__`, `__MASTER_TAG__`, `__STATE_N__`, `__TRANSITION_N__`,
 * `__ACTION_N__`, `__CONTEXT_N__`, and `__SLOT_name__` patterns.
 */
export function normalizeIds (docs: Doc[]): Doc[] {
  const idMap = buildNormalizationMap(docs)

  return docs.map((doc) => {
    let json = JSON.stringify(doc)
    // Normalize dot-separated class/method IDs to colon-separated
    json = json.replace(/"([a-z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+)"/g, (_, p1) => `"${p1.replace(/\./g, ':')}"`)

    // Replace IDs sorted by length (longest first to avoid partial matches)
    const sortedIds = Object.keys(idMap).sort((a, b) => b.length - a.length)
    for (const id of sortedIds) {
      json = replaceIdInJson(json, id, idMap[id])
    }
    return JSON.parse(json)
  })
}

/** Builds the mapping from real IDs to normalized placeholders. */
function buildNormalizationMap (docs: Doc[]): Record<string, string> {
  const idMap: Record<string, string> = {}
  let stateCount = 0
  let transitionCount = 0
  let contextCount = 0
  let actionCount = 0

  for (const doc of docs) {
    if (doc._class === processPlugin.class.Process) {
      idMap[doc._id] = '__PROCESS__'
      const proc = doc as any
      if (proc.masterTag !== undefined) idMap[proc.masterTag] = '__MASTER_TAG__'
      if (proc.context !== undefined) {
        for (const contextId in proc.context) {
          idMap[contextId] = `__CONTEXT_${contextCount++}__`
        }
      }
      if (proc.bindings !== undefined) {
        for (const [slotId, attrId] of Object.entries(proc.bindings)) {
          if (typeof attrId === 'string' && attrId.length > 0) {
            idMap[attrId] = `__SLOT_${slotId}__`
          }
        }
      }
    } else if (doc._class === processPlugin.class.State) {
      idMap[doc._id] = `__STATE_${stateCount++}__`
    } else if (doc._class === processPlugin.class.Transition) {
      idMap[doc._id] = `__TRANSITION_${transitionCount++}__`
      const tr = doc as Transition
      for (const action of tr.actions) {
        idMap[action._id] = `__ACTION_${actionCount++}__`
        if (action.context !== undefined && action.context !== null) {
          if (idMap[action.context._id] === undefined) {
            idMap[action.context._id] = `__CONTEXT_${contextCount++}__`
          }
        }
        if (action.results !== undefined) {
          for (const res of action.results) {
            idMap[res._id] = `__CONTEXT_${contextCount++}__`
          }
        }
      }
    }
  }
  return idMap
}

/**
 * Replaces an ID within a JSON string using an appropriate strategy:
 * - 24/30-char IDs: global split/join (safe for hex/custom IDs)
 * - Shorter IDs: surgical regex to avoid replacing JSON keys
 */
function replaceIdInJson (json: string, id: string, replacement: string): string {
  if (id.length === 24 || id.length === 30) {
    return json.split(id).join(replacement)
  }
  const escapedId = id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  const regex = new RegExp(
    `(?<=[@(\\s,])\\b${escapedId}\\b|\\b${escapedId}\\b(?=[)\\s,])|(?<=:\\s?")${escapedId}(?=")`,
    'g'
  )
  return json.replace(regex, replacement)
}

/**
 * Replaces placeholder IDs with real IDs for the target environment.
 * Generates fresh IDs for states, transitions, actions, and contexts.
 * Bindings map slot placeholders to their actual bound entity IDs.
 */
export function denormalizeIds (docs: Doc[], masterTag: Ref<MasterTag>, bindings?: Record<string, string>): Doc[] {
  const idMap: Record<string, string> = {
    __PROCESS__: generateId(),
    __MASTER_TAG__: masterTag
  }

  // Map slot placeholders to bound IDs
  if (bindings !== undefined) {
    for (const [slotId, attrId] of Object.entries(bindings)) {
      idMap[`__SLOT_${slotId}__`] = attrId
    }
  }

  // Discover all remaining placeholders and assign fresh IDs
  const findPlaceholders = (val: any): void => {
    if (typeof val === 'string') {
      for (const m of val.matchAll(/(__[a-zA-Z0-9_]+__)/g)) {
        if (idMap[m[1]] === undefined) {
          idMap[m[1]] = generateId()
        }
      }
    } else if (Array.isArray(val)) {
      val.forEach(findPlaceholders)
    } else if (typeof val === 'object' && val !== null) {
      for (const k of Object.keys(val)) {
        findPlaceholders(k)
        findPlaceholders(val[k])
      }
    }
  }
  docs.forEach(findPlaceholders)

  // Replace all placeholders (longest first)
  const sortedPlaceholders = Object.keys(idMap).sort((a, b) => b.length - a.length)
  return docs.map((doc) => {
    let json = JSON.stringify(doc)
    for (const placeholder of sortedPlaceholders) {
      json = json.split(placeholder).join(idMap[placeholder])
    }
    const denormalized = JSON.parse(json)
    if (denormalized._class === processPlugin.class.Process) {
      denormalized.masterTag = masterTag
    }
    return denormalized
  })
}

// ─── Slot Detection ──────────────────────────────────────────────────────────

/**
 * System parameters for each method that should NOT be treated as user-bound slots.
 * Keyed by normalized method ID.
 */
function getMethodSystemParams (methodId: string): string[] {
  const normalized = normalizeId(methodId)
  if (normalized === normalizeId(processPlugin.method.RunSubProcess)) return ['_id', 'card', 'context']
  if (
    normalized === normalizeId(processPlugin.method.AddRelation) ||
    normalized === normalizeId(processPlugin.method.RemoveRelation)
  ) {
    return ['_id', 'card', 'direction']
  }
  if (normalized === normalizeId(processPlugin.method.UpdateContext)) return ['contextId', 'value']
  if (normalized === normalizeId(processPlugin.method.AddTag)) return ['_id', 'card']
  if (normalized === normalizeId(processPlugin.method.CreateToDo)) return ['state', 'title', 'user', 'withRollback']
  if (normalized === normalizeId(processPlugin.method.CreateAction)) return ['title', 'eventType', 'user']
  if (normalized === normalizeId(processPlugin.method.CreateCard)) return ['_class', 'title']
  return []
}

/** Extracts all potential entity IDs from a DSL string value. */
function extractPotentialIds (val: string): Set<string> {
  const ids = new Set<string>()
  // DSL attribute references: ${@attrName ...}
  for (const m of val.matchAll(/\$\{@([a-zA-Z0-9_]+)/g)) ids.add(m[1])
  // Document IDs: 24-char hex or 30-char custom
  for (const m of val.matchAll(/\b(?:custom)?[0-9a-zA-Z]{24,30}\b/g)) ids.add(m[0])
  // Already-normalized slot references
  if (val.startsWith('__SLOT_')) ids.add(val)
  // Fallback: entire value if it looks like a simple identifier
  if (val.length > 0 && !val.includes(' ') && !val.includes('$')) ids.add(val)
  return ids
}

/**
 * Determines the active MasterTag context for an action step.
 * Uses explicit context, method-specific logic, or falls back to the process MasterTag.
 */
function resolveActionContext (
  step: any,
  contextClasses: Record<string, Ref<MasterTag>>,
  masterTag: Ref<MasterTag>
): Ref<MasterTag> {
  const methodId = normalizeId(step.methodId)

  // Explicit context
  if (step.context?._class !== undefined) return step.context._class

  // CreateCard provides the target class directly
  if (methodId === normalizeId(processPlugin.method.CreateCard) && step.params?._class !== undefined) {
    return step.params._class
  }

  // AddRelation/RunSubProcess derive context from $context() references
  if (methodId === normalizeId(processPlugin.method.AddRelation) && step.params?._id !== undefined) {
    const ctxId = step.params._id.match(/\$context\("?([a-zA-Z0-9_]+)/)?.[1]
    if (ctxId !== undefined && contextClasses[ctxId] !== undefined) return contextClasses[ctxId]
  }

  if (methodId === normalizeId(processPlugin.method.RunSubProcess) && step.params?.card !== undefined) {
    const ctxId = step.params.card.match(/\$context\("?([a-zA-Z0-9_]+)/)?.[1]
    if (ctxId !== undefined && contextClasses[ctxId] !== undefined) return contextClasses[ctxId]
  }

  return masterTag
}

/**
 * Resolves the memberOf slot reference for a process or association whose
 * target class differs from the process's masterTag.
 *
 * If the target class is foreign, creates a parent class slot and returns
 * its `__SLOT_name__` reference for use as `memberOf`.
 */
function resolveParentSlot (
  targetTag: Ref<MasterTag> | undefined,
  masterTag: Ref<MasterTag>,
  memberOfRef: string | undefined,
  getOrAddSlot: (id: string, model: DetailedSlotModel) => string,
  m: ModelDb
): string | undefined {
  if (targetTag === undefined || targetTag === '') {
    return memberOfRef
  }
  if (normalizeId(targetTag) === normalizeId(masterTag)) {
    return undefined
  }
  const targetDoc = m.findObject(targetTag) as Class<any> | undefined
  const parentSlotId = getOrAddSlot(
    targetTag,
    targetDoc !== undefined ? classToSlot(targetDoc) : unknownToSlot(targetTag)
  )
  return `__SLOT_${parentSlotId}__`
}

/**
 * Scans all transitions to detect environment-specific references
 * (attributes, associations, sub-processes) and registers them as named slots.
 *
 * Populates `slots` with slot metadata and `bindings` with the mapping
 * from slot names to actual entity IDs.
 */
export function detectSlots (
  proc: Process,
  transitions: Transition[],
  slots: Record<string, SlotModel>,
  bindings: Record<string, string>,
  m: ModelDb,
  h: Hierarchy,
  includeSystemBindings: boolean = false
): void {
  const masterTag = proc.masterTag
  const attrToSlot: Record<string, string> = {}
  const contextClasses: Record<string, Ref<MasterTag>> = {}

  // Initialize context classes from process context
  if (proc.context !== undefined) {
    for (const [id, ctx] of Object.entries(proc.context)) {
      if (ctx.type?._class === core.class.RefTo) {
        contextClasses[id] = (ctx.type as any).to
      }
    }
  }

  // Initialize reverse mapping from existing bindings
  for (const [slotId, attrId] of Object.entries(bindings)) {
    attrToSlot[attrId] = slotId
  }

  // ── Slot Registration ────────────────────────

  /** Registers or updates a slot. Returns the slot name. */
  const getOrAddSlot = (id: string, model: DetailedSlotModel): string => {
    let slotName = attrToSlot[id]

    // Generate a new slot name if this ID hasn't been seen
    if (slotName === undefined) {
      slotName =
        model.name ?? (model.label !== undefined && typeof model.label === 'string' ? model.label : undefined) ?? id
      if (slotName.startsWith('custom') || Object.values(attrToSlot).includes(slotName)) {
        slotName = `slot${Object.keys(attrToSlot).length + 1}`
      }
      attrToSlot[id] = slotName

      const normalizedId = normalizeId(id) ?? ''
      if (!id.startsWith('__SLOT_') && (!isSystemId(normalizedId) || includeSystemBindings)) {
        bindings[slotName] = id
      }
    }

    // Don't overwrite concrete metadata with unknown
    const existingSlot = slots[slotName]
    if (existingSlot !== undefined && model.slotKind === 'unknown') return slotName

    const meta: SlotModel = existingSlot ?? {
      slotKind: model.slotKind,
      _class: model._class
    }

    // Upgrade unknown → concrete
    if (meta.slotKind === 'unknown' || meta.slotKind === undefined) {
      meta.slotKind = model.slotKind
    }

    // Merge type-specific metadata
    if (model.slotKind === 'attribute') {
      mergeAttributeSlotMeta(meta, model as AttributeSlotModel)
    } else {
      mergeNonAttributeSlotMeta(meta, model)
    }

    // Set memberOf unless it would be self-referential or undefined
    const selfRef = `__SLOT_${slotName}__`
    if (model.memberOf !== undefined && model.memberOf !== selfRef) {
      meta.memberOf = model.memberOf
    }

    slots[slotName] = meta
    return slotName
  }

  // ── Param Scanning ───────────────────────────

  /** Scans action/trigger params to find slottable references. */
  const scanParams = (
    params: Record<string, any> | undefined,
    activeTag: Ref<MasterTag>,
    requiredParams: string[] = []
  ): void => {
    if (params === undefined) return

    // Ensure the active tag itself is registered as a slot if non-system & non-master
    const nTag = normalizeId(activeTag) ?? ''
    if (activeTag !== masterTag && attrToSlot[activeTag] === undefined && !isSystemId(nTag)) {
      const tagDoc = m.findObject(activeTag) as any
      if (tagDoc !== undefined) {
        if (normalizeId(tagDoc._class) === normalizeId(core.class.Attribute)) {
          getOrAddSlot(activeTag, attributeToSlot(tagDoc))
        } else {
          getOrAddSlot(activeTag, classToSlot(tagDoc))
        }
      } else {
        getOrAddSlot(activeTag, unknownToSlot(activeTag))
      }
    }

    const memberOf = activeTag !== masterTag ? attrToSlot[activeTag] : undefined
    const memberOfRef = memberOf !== undefined && memberOf !== '' ? `__SLOT_${memberOf}__` : undefined

    for (const key in params) {
      const val = params[key]
      // Scan keys as potential attribute references
      scanParamKey(key, val, activeTag, masterTag, memberOfRef, requiredParams, h, getOrAddSlot, m)

      // Scan values for entity references
      if (typeof val === 'string') {
        scanParamValue(val, activeTag, masterTag, memberOfRef, params.direction, slots, getOrAddSlot, m, h)
      } else if (typeof val === 'object' && val !== null) {
        scanParams(val, activeTag)
      }
    }
  }

  // ── Main Loop ────────────────────────────────

  for (const tr of transitions) {
    const triggerDoc = m.findObject(tr.trigger) as any
    const triggerRequired = triggerDoc?.requiredParams ?? []
    scanParams(tr.triggerParams, masterTag, triggerRequired)

    for (const step of tr.actions) {
      const methodDoc = m.findObject(step.methodId)
      const methodRequired = methodDoc?.requiredParams ?? []

      // Register result contexts for subsequent action resolution
      if (step.results !== undefined) {
        for (const res of step.results) {
          if (res.type?._class === core.class.RefTo) {
            contextClasses[res._id] = (res.type as RefTo<Doc>).to
          }
        }
      }

      const activeTag = resolveActionContext(step, contextClasses, masterTag)
      if (step.context?._id != null) {
        contextClasses[step.context._id] = activeTag
      }

      const sysParams = getMethodSystemParams(step.methodId)
      scanParams(step.params, activeTag, [...methodRequired, ...sysParams])
      if (includeSystemBindings) {
        for (const result of step.results ?? []) {
          if (result.key !== undefined) {
            scanParamValue(result.key, masterTag, masterTag, undefined, undefined, slots, getOrAddSlot, m, h)
          }
          if (result.selectionSpace !== undefined) {
            scanParamValue(result.selectionSpace, masterTag, masterTag, undefined, undefined, slots, getOrAddSlot, m, h)
          }
          if (result.excludeRelation !== undefined) scanParams(result.excludeRelation, masterTag)
        }
      }
    }
  }
  if (includeSystemBindings) {
    for (const context of Object.values(proc.context ?? {})) {
      scanParams(context.value, masterTag)
      const scanType = (type: Type<unknown> | undefined): void => {
        if (type?._class === core.class.RefTo) {
          scanParamValue((type as RefTo<Doc>).to, masterTag, masterTag, undefined, undefined, slots, getOrAddSlot, m, h)
        } else if (type?._class === core.class.ArrOf) scanType((type as ArrOf<Doc>).of)
      }
      scanType(context.type)
    }
  }
}

// ─── Slot Detection Helpers ──────────────────────────────────────────────────

/** Merges attribute-specific metadata into a slot. */
function mergeAttributeSlotMeta (meta: SlotModel, model: AttributeSlotModel): void {
  if (typeof model.type === 'object' && model.type !== null) {
    ;(meta as any).type = model.type
    meta._class = model.type._class
  } else if (typeof model.type === 'string') {
    meta._class = model.type
  }
  if (model.label !== undefined) meta.label = model.label
}

/** Merges non-attribute (process/association/class) metadata into a slot. */
function mergeNonAttributeSlotMeta (meta: SlotModel, model: DetailedSlotModel): void {
  const currentClass = normalizeId(meta._class)
  const isStrongType =
    currentClass === normalizeId(processPlugin.class.Process) || currentClass === normalizeId(core.class.Association)

  if (!isStrongType || model.slotKind === 'process' || model.slotKind === 'association') {
    meta._class = model._class
    if (model.label !== undefined) meta.label = model.label
  }
  if (
    model.name !== undefined &&
    model.name !== '' &&
    (model.slotKind === 'process' || model.slotKind === 'association')
  ) {
    meta.name = model.name
  }
}

/** Checks if a value is contextual/dynamic (e.g. contains DSL, is an ID, or nested object). */
function isContextualValue (
  val: any,
  activeTag: Ref<MasterTag>,
  masterTag: Ref<MasterTag>,
  h: Hierarchy,
  m: ModelDb
): boolean {
  if (typeof val === 'string') {
    if (val.includes('${')) return true
    if (val.startsWith('__SLOT_')) return true
    const potentialIds = extractPotentialIds(val)
    for (const id of potentialIds) {
      const obj = h.findAttribute(activeTag, id) ?? h.findAttribute(masterTag, id) ?? m.findObject(id as any)
      if (obj !== undefined) return true
    }
  }
  if (typeof val === 'object' && val !== null) {
    return true
  }
  return false
}

/** Checks if a param key represents a slottable attribute. */
function scanParamKey (
  key: string,
  val: any,
  activeTag: Ref<MasterTag>,
  masterTag: Ref<MasterTag>,
  memberOfRef: string | undefined,
  requiredParams: string[],
  h: Hierarchy,
  getOrAddSlot: (id: string, model: DetailedSlotModel) => string,
  m: ModelDb
): void {
  if (key.startsWith('$') || key === '_id' || key === '_class' || requiredParams.includes(key)) return

  if (typeof val === 'string' && val.includes('$userRequest')) {
    return
  }

  const keyAttr = (h.findAttribute(activeTag, key) ?? h.findAttribute(masterTag, key)) as Attribute<any> | undefined
  if (keyAttr !== undefined) {
    // For system attributes, only slotify if the value is contextual/dynamic
    const parentClassId = normalizeId(keyAttr.attributeOf) ?? ''
    if (isSystemId(parentClassId) && !isContextualValue(val, activeTag, masterTag, h, m)) {
      return
    }
    const attrMemberOf = resolveParentSlot(keyAttr.attributeOf, masterTag, memberOfRef, getOrAddSlot, m)
    getOrAddSlot(key, attributeToSlot(keyAttr, attrMemberOf))
  } else if (key.length >= 24) {
    getOrAddSlot(key, unknownToSlot(key, memberOfRef))
  }
}

/** Scans a string param value for entity references and registers them as slots. */
function scanParamValue (
  val: string,
  activeTag: Ref<MasterTag>,
  masterTag: Ref<MasterTag>,
  memberOfRef: string | undefined,
  direction: string | undefined,
  slots: Record<string, SlotModel>,
  getOrAddSlot: (id: string, model: DetailedSlotModel) => string,
  m: ModelDb,
  h: Hierarchy
): void {
  if (val.includes('$userRequest')) {
    return
  }
  const potentialIds = extractPotentialIds(val)

  for (const id of potentialIds) {
    const obj = h.findAttribute(activeTag, id) ?? h.findAttribute(masterTag, id) ?? m.findObject(id as any)

    if (obj === undefined) {
      // Handle already-normalized slot references
      if (id.startsWith('__SLOT_')) {
        const slotName = id.replace(/^__SLOT_(.+)__$/, '$1')
        const existing = slots[slotName]
        if (existing !== undefined) {
          const slotModel: SlotModel = { ...existing, name: slotName, memberOf: memberOfRef }
          getOrAddSlot(id, slotModel)
        }
      }
      continue
    }

    classifyAndRegisterSlot(id, obj, direction, memberOfRef, masterTag, getOrAddSlot, m, h)
  }
}

/**
 * Classifies a resolved object by its type and registers it as the appropriate slot kind.
 */
function classifyAndRegisterSlot (
  id: string,
  obj: Doc,
  direction: string | undefined,
  memberOfRef: string | undefined,
  masterTag: Ref<MasterTag>,
  getOrAddSlot: (id: string, model: DetailedSlotModel) => string,
  m: ModelDb,
  h: Hierarchy
): void {
  const classId = normalizeId(obj._class)

  if (classId === normalizeId(processPlugin.class.Process)) {
    const subProc = obj as any as Process
    const procMemberOf = resolveParentSlot(subProc.masterTag, masterTag, memberOfRef, getOrAddSlot, m)
    getOrAddSlot(id, processToSlot(subProc, procMemberOf))
  } else if (classId === normalizeId(core.class.Association)) {
    const assoc = obj as any as Association
    const targetClass = direction === 'A' ? assoc.classA : assoc.classB
    const assocMemberOf = resolveParentSlot(targetClass, masterTag, memberOfRef, getOrAddSlot, m)
    getOrAddSlot(id, associationToSlot(assoc, direction, assocMemberOf))
  } else if (classId === normalizeId(core.class.Attribute)) {
    const attr = obj as Attribute<any>
    const attrMemberOf = resolveParentSlot(attr.attributeOf, masterTag, memberOfRef, getOrAddSlot, m)
    getOrAddSlot(id, attributeToSlot(attr, attrMemberOf))
  } else if (classId === normalizeId(core.class.Class) || h.isDerived(obj._class, core.class.Class)) {
    getOrAddSlot(id, classToSlot(obj as any as Class<any>, memberOfRef))
  } else {
    getOrAddSlot(id, unknownToSlot(id, memberOfRef))
  }
}
