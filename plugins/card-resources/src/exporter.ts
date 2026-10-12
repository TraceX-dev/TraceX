// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import core, {
  type AnyAttribute,
  type ArrOf,
  type AttachedData,
  type AttachedDoc,
  type Class,
  type Data,
  type Doc,
  type EnumOf,
  generateId,
  type Hierarchy,
  type ModelDb,
  type Ref,
  type RefTo,
  type TypeIdentifier
} from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import {
  exportAuthoringModel,
  getAuthoringCatalog,
  getAuthoringProcessIdentities,
  parseProcessImport,
  remapAuthoringReferences,
  validateAuthoringModelOperations,
  type AuthoringNativeDocument
} from '@hcengineering/process'
import view from '@hcengineering/view'
import { deepEqual } from 'fast-equals'
import card from './plugin'

export async function importModule (json: string, createNew: boolean = false): Promise<void> {
  try {
    const rawData = parseProcessImport(json, 'card', getClient().getModel())
    let data = Array.from(new Map(rawData.map((d) => [d._id, d])).values())
    const client = getClient()
    const m = client.getModel()
    const h = client.getHierarchy()
    if (!json.trimStart().startsWith('[')) {
      validateAuthoringModelOperations(data as unknown as AuthoringNativeDocument[], m, h)
      if (createNew) data = cloneModule(data, m, h)
    }
    const apply = client.apply('Import')
    for (const elem of data) {
      const existing = m.findObject(elem._id)
      if (existing !== undefined) {
        const newData = stripData(elem)
        const oldData = stripData(existing)
        if (!deepEqual(newData, oldData)) {
          await apply.updateDoc(elem._class, existing.space, elem._id, newData)
        }
        continue
      }
      if (h.isDerived(elem._class, core.class.AttachedDoc)) {
        const attachedDoc = elem as AttachedDoc
        await apply.addCollection(
          attachedDoc._class,
          attachedDoc.space,
          attachedDoc.attachedTo,
          attachedDoc.attachedToClass,
          attachedDoc.collection,
          stripAttached(attachedDoc),
          attachedDoc._id
        )
      } else {
        await apply.createDoc(elem._class, elem.space, stripData(elem), elem._id)
      }
    }
    const result = await apply.commit(true)
    if (!result?.result) throw new Error('Importing the card module failed')
  } catch (e) {
    console.error('Failed to import process module:', e)
    throw e
  }
}

function stripAttached (doc: AttachedDoc): AttachedData<AttachedDoc> {
  const { collection, attachedTo, attachedToClass, ...rest } = strip(doc)
  return rest
}

function stripData<T extends Doc> (doc: T): Data<T> {
  const { _id, _class, space, ...rest } = strip(doc)
  return rest as Data<T>
}

export async function exportModule (_id: Ref<Class<Doc>>, format: 'json' | 'yaml' = 'json'): Promise<string> {
  const processed = new Set<Ref<Doc>>()
  const res = await exportType(_id, processed, false, format === 'yaml')
  const unique = Array.from(new Map(res.map((d) => [d._id, d])).values())
  const clear = unique.map(strip)
  if (format === 'json') return JSON.stringify(clear)
  return exportAuthoringModel(clear, 'card', getAuthoringCatalog(getClient().getModel()))
}

/** Copies full modules for the editor's Create new action; file imports retain native JSON identity semantics. */
function cloneModule (documents: Doc[], model: ModelDb, hierarchy: Hierarchy): Doc[] {
  const mapping = new Map(documents.map((doc) => [String(doc._id), String(generateId())]))
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

function strip<T extends Doc> (doc: T): Omit<T, 'modifiedBy' | 'modifiedOn' | 'createdBy' | 'createdOn'> {
  const { modifiedBy, modifiedOn, createdBy, createdOn, ...rest } = doc
  return rest
}

async function exportAttribute (
  attr: AnyAttribute,
  m: ModelDb,
  h: Hierarchy
): Promise<{
  docs: Doc[]
  required: Array<Ref<Class<Doc>>>
}> {
  const client = getClient()
  const docs: Doc[] = []
  const required: Array<Ref<Class<Doc>>> = []
  docs.push(attr)

  docs.push(...m.findAllSync(core.class.AttributePermission, { attribute: attr._id }))
  if (attr.type._class === core.class.TypeIdentifier) {
    const of = (attr.type as TypeIdentifier).of
    const seq = await client.findOne(core.class.Sequence, { _id: of })
    if (seq !== undefined) {
      const exportedSequence = { ...seq, sequence: 0 }
      docs.push(exportedSequence)
    }
  }
  if (attr.type._class === core.class.EnumOf) {
    const of = (attr.type as EnumOf).of
    const val = m.findObject(of)
    if (val !== undefined) docs.push(val)
  }
  if (attr.type._class === core.class.RefTo) {
    const to = (attr.type as RefTo<Doc>).to
    if (h.isDerived(to, card.class.Card)) {
      required.push(to)
    }
  }
  if (attr.type._class === core.class.ArrOf) {
    const of = (attr.type as ArrOf<Doc>).of
    if (of._class === core.class.RefTo) {
      const to = (of as RefTo<Doc>).to
      if (h.isDerived(to, card.class.Card)) {
        required.push(to)
      }
    }
    if (of._class === core.class.EnumOf) {
      const val = m.findObject((of as EnumOf).of)
      if (val !== undefined) docs.push(val)
    }
  }
  return { docs, required }
}

async function exportType (
  _id: Ref<Class<Doc>>,
  processed: Set<Ref<Doc>>,
  withoutDesc: boolean = false,
  preserveIcon: boolean = false
): Promise<Doc[]> {
  if (processed.has(_id)) return []
  processed.add(_id)
  const res: Doc[] = []
  const required: Array<Ref<Class<Doc>>> = []
  const client = getClient()
  const m = client.getModel()
  const h = client.getHierarchy()
  const type = m.findObject(_id)
  if (type === undefined) return res

  const parent = h.getClass(_id).extends
  if (parent !== undefined && h.isDerived(parent, card.class.Card) && parent !== card.class.Card) {
    if (!processed.has(parent)) {
      res.push(...(await exportType(parent, processed, withoutDesc, preserveIcon)))
    }
  }

  res.push(...m.findAllSync(view.class.Viewlet, { attachTo: _id }))

  res.push(
    !preserveIcon && type.icon === view.ids.IconWithEmoji && typeof type.color === 'string'
      ? { ...type, icon: card.icon.Card }
      : type
  )

  res.push(...m.findAllSync(core.class.ClassPermission, { targetClass: _id }))

  const attrs = h.getOwnAttributes(_id)
  for (const attr of attrs) {
    const at = await exportAttribute(attr[1], m, h)
    res.push(...at.docs)
    required.push(...at.required)
  }

  if (!withoutDesc && _id !== card.class.Card) {
    const descendants = h.getDescendants(_id)
    for (const desc of descendants) {
      if (h.getClass(desc).extends !== _id) continue
      required.push(desc)
    }
  }

  res.push(...m.findAllSync(card.class.Role, { types: _id }))

  const assocA = m.findAllSync(core.class.Association, { classA: _id })
  for (const assoc of assocA) {
    res.push(assoc)
    required.push(assoc.classB)
  }

  const assocB = m.findAllSync(core.class.Association, { classB: _id })
  for (const assoc of assocB) {
    res.push(assoc)
    required.push(assoc.classA)
  }

  const extensions = m.findAllSync(card.class.ExportExtension, {})
  for (const ext of extensions) {
    const f = await getResource(ext.func)
    const extRes = f(_id)
    res.push(...extRes.docs)
    required.push(...extRes.required)
  }

  for (const req of required) {
    res.push(...(await exportType(req, processed, false, preserveIcon)))
  }
  return res
}
