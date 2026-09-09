//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import contact, { getName, getPersonByPersonRef } from '@hcengineering/contact'
import core, {
  type AnyAttribute,
  type Association,
  type Class,
  ClassifierKind,
  type Doc,
  type Hierarchy,
  type Ref,
  type SortingQuery
} from '@hcengineering/core'
import { translate, type IntlString } from '@hcengineering/platform'
import { type Execution } from '@hcengineering/process'
import { type ProcessControl } from '@hcengineering/server-process'
import { jsonToMarkup, markupToText } from '@hcengineering/text-core'
import { markdownToMarkup } from '@hcengineering/text-markdown'
import view, { type BuildModelKey, type Viewlet } from '@hcengineering/view'

function parseSortingQuery (sort: unknown): SortingQuery<Doc> | undefined {
  if (sort == null) return undefined
  if (Array.isArray(sort)) {
    const q: Record<string, any> = {}
    for (const item of sort) {
      if (Array.isArray(item) && item.length >= 2 && typeof item[0] === 'string') {
        q[item[0]] = item[1]
      } else if (typeof item === 'string') {
        q[item] = 1
      }
    }
    return Object.keys(q).length > 0 ? (q as SortingQuery<Doc>) : undefined
  }
  if (typeof sort === 'object') {
    return sort as SortingQuery<Doc>
  }
  if (typeof sort === 'string') {
    const res: SortingQuery<Doc> = { [sort]: 1 }
    return res
  }
  return undefined
}

function isIntlString (value: unknown): value is IntlString {
  if (typeof value !== 'string' || value.length === 0) {
    return false
  }
  if (value.includes('://')) {
    return false
  }
  if (value.startsWith('embedded:embedded:')) {
    return value.length > 'embedded:embedded:'.length
  }
  const m = /^([a-z][a-z0-9-]*):([a-zA-Z][a-zA-Z0-9_]*):(.+)$/.exec(value)
  if (m === null) {
    return false
  }
  const pluginName = m[1]
  const rest = m[3]
  if (rest.length === 0) {
    return false
  }
  if (/^https?$/i.test(pluginName)) {
    return false
  }
  return true
}

function formatIntlOrId (val: string): string {
  if (val === '') return ''
  if (isIntlString(val)) {
    const parts = val.split(':')
    const name = parts[parts.length - 1]
    if (name !== undefined && name !== '') {
      return name.replace(/([A-Z])/g, ' $1').trim()
    }
  }
  return val
}

async function translateOrClean (val: unknown, language: string = 'en'): Promise<string> {
  if (val == null) return ''
  let text = String(val)
  if (isIntlString(val)) {
    try {
      text = await translate(val, {}, language)
    } catch {}
  }
  return formatIntlOrId(text)
}

function escapeMarkdownTableCellContent (value: string): string {
  const s = value == null ? '' : String(value)
  return s.replace(/\\?\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function formatDate (value: number, isDateOnly: boolean): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

async function resolveCustomAttributeLabel (
  attrLabel: string,
  docClass: Ref<Class<Doc>>,
  hierarchy: Hierarchy,
  language: string = 'en'
): Promise<string> {
  if (!attrLabel.startsWith('custom')) {
    return attrLabel
  }

  let customAttr = hierarchy.findAttribute(docClass, attrLabel)
  if (customAttr === undefined) {
    const allAttrs = hierarchy.getAllAttributes(docClass)
    customAttr = allAttrs.get(attrLabel)
  }

  if (customAttr?.label !== undefined) {
    return await translateOrClean(customAttr.label, language)
  }

  return attrLabel
}

interface ColumnDef {
  key: string
  label: string
  attr?: AnyAttribute
  isTitle: boolean
  isTags: boolean
  isAssoc: boolean
  customKey?: string
}

async function resolveHeaderLabel (
  item: string | BuildModelKey,
  targetClass: Ref<Class<Doc>>,
  hierarchy: Hierarchy,
  control: ProcessControl,
  firstTitleHandled: { value: boolean },
  language: string = 'en'
): Promise<ColumnDef | undefined> {
  const rawKey = typeof item === 'string' ? item : item.key
  let label = typeof item === 'object' && item.label !== undefined ? String(item.label) : ''
  let customKey: string | undefined

  // 1. Check if it is custom attribute
  if (label.startsWith('custom')) {
    customKey = label
    label = await resolveCustomAttributeLabel(label, targetClass, hierarchy, language)
  } else if (rawKey.startsWith('custom')) {
    customKey = rawKey
    label = await resolveCustomAttributeLabel(rawKey, targetClass, hierarchy, language)
  }

  // 2. Check if it is an association key ($associations.assocId_a...)
  let isAssoc = false
  if (rawKey.startsWith('$associations')) {
    isAssoc = true
    const parts = rawKey.split('.')
    let lastAssocIndex = -1
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '$associations' && i + 1 < parts.length) {
        lastAssocIndex = i
      }
    }
    if (lastAssocIndex !== -1) {
      const fragments = parts[lastAssocIndex + 1].split('_')
      const assocId = fragments[0] as Ref<Association>
      const assoc = control.client.getModel().findObject(assocId)
      if (assoc !== undefined) {
        label = fragments[1] === 'a' ? (assoc.nameA ?? assoc._id) : (assoc.nameB ?? assoc._id)
      } else {
        label = 'Relation'
      }
    }
  }

  // 3. Check if it is a Tags column
  const isTags =
    rawKey === 'tags' ||
    label === 'Tags' ||
    label.endsWith(':Tags') ||
    (typeof item === 'object' && String((item as any).presenter ?? '').includes('CardTagsColored'))

  if (isTags) {
    label = 'Tags'
  }

  // 4. Title column check
  let isTitle = false
  if (rawKey === '' && customKey === undefined && !isTags && !isAssoc) {
    if (!firstTitleHandled.value) {
      isTitle = true
      firstTitleHandled.value = true
      label = label !== '' ? label : 'Title'
    } else {
      return undefined
    }
  }

  // 5. Fallback attribute resolution
  const attr = rawKey.length > 0 ? hierarchy.findAttribute(targetClass, rawKey) : undefined
  if (label === '' || isIntlString(label)) {
    if (attr?.label !== undefined) {
      label = await translateOrClean(attr.label, language)
    } else if (label === '') {
      label =
        rawKey.charAt(0).toUpperCase() +
        rawKey
          .slice(1)
          .replace(/([A-Z])/g, ' $1')
          .trim()
    }
  }

  // 6. Clean up any raw intl strings like "card:string:MasterTag" or "core:string:ModifiedDate"
  label = await translateOrClean(label, language)

  return { key: rawKey, label, attr, isTitle, isTags, isAssoc, customKey }
}

function getCardTags (card: Doc, hierarchy: Hierarchy): string {
  try {
    const parentClass = hierarchy.getParentClass(card._class)
    const mixins = hierarchy
      .getDescendants(parentClass)
      .filter((m) => hierarchy.getClass(m).kind === ClassifierKind.MIXIN && hierarchy.hasMixin(card, m))
    const labels: string[] = []
    for (const ref of mixins) {
      const mc = hierarchy.getClass(ref)
      if (mc?.label != null) {
        labels.push(formatIntlOrId(String(mc.label)))
      }
    }
    return labels.join(', ')
  } catch {
    return ''
  }
}

async function formatCellValue (
  value: any,
  attr: AnyAttribute | undefined,
  lookupCache: Map<string, string>
): Promise<string> {
  if (value === undefined || value === null) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (attr?.type?._class === core.class.TypeTimestamp || attr?.type?._class === core.class.TypeDate) {
      return formatDate(value, attr.type._class === core.class.TypeDate)
    }
    return String(value)
  }
  if (value instanceof Date) {
    return formatDate(value.getTime(), true)
  }
  if (typeof value === 'string') {
    const cached = lookupCache.get(value)
    if (cached !== undefined) {
      return cached
    }
    if (isIntlString(value)) {
      return await translateOrClean(value, 'en')
    }
    const isMarkup =
      attr?.type?._class === core.class.TypeMarkup || (value.startsWith('{"') && value.includes('"type":"doc"'))
    if (isMarkup) {
      try {
        const text = markupToText(value)
        return text.replace(/\r?\n/g, ' ').trim()
      } catch {}
    }
    return value
  }
  if (Array.isArray(value)) {
    const formatted = await Promise.all(
      value.map(async (v) => {
        if (typeof v === 'string') {
          const cached = lookupCache.get(v)
          if (cached !== undefined) {
            return cached
          }
        }
        return String(v)
      })
    )
    return formatted.filter((s) => s.length > 0).join(', ')
  }
  if (typeof value === 'object') {
    const title = value.title ?? value.name ?? value.label
    if (title != null) return await translateOrClean(title, 'en')
  }
  return String(value)
}

function sortDocuments (docs: Doc[], sortQuery: SortingQuery<Doc>): void {
  const entries = Object.entries(sortQuery)
  if (entries.length === 0) return

  const [field, order] = entries[0]
  const orderNum = typeof order === 'number' ? order : 1

  docs.sort((a, b) => {
    const valA = (a as any)[field]
    const valB = (b as any)[field]
    if (valA === undefined && valB === undefined) return 0
    if (valA === undefined) return 1
    if (valB === undefined) return -1
    const numA =
      typeof valA === 'number'
        ? valA
        : typeof valA === 'string' && valA.trim() !== '' && !isNaN(Number(valA))
          ? Number(valA)
          : NaN
    const numB =
      typeof valB === 'number'
        ? valB
        : typeof valB === 'string' && valB.trim() !== '' && !isNaN(Number(valB))
          ? Number(valB)
          : NaN
    if (!isNaN(numA) && !isNaN(numB)) {
      return (numA - numB) * orderNum
    }
    return String(valA).localeCompare(String(valB)) * orderNum
  })
}

/**
 * Builds a markdown table from relations connected to the execution's card,
 * then converts it into a Huly Markup string.
 */
export async function buildMarkdownTableForRelation (
  control: ProcessControl,
  execution: Execution,
  props: Record<string, any>
): Promise<string> {
  if (props?.association === undefined || execution.card === undefined) {
    return ''
  }

  const isDirectionB = props.direction === 'B'
  const relationQuery: Record<string, any> = {
    association: props.association
  }
  if (isDirectionB) {
    relationQuery.docA = execution.card
  } else {
    relationQuery.docB = execution.card
  }

  const relations = await control.client.findAll(core.class.Relation, relationQuery)
  if (relations.length === 0) {
    return ''
  }

  const targetIds = relations.map((r) => (isDirectionB ? r.docB : r.docA))
  const targetClass = (props.targetClass as Ref<Class<Doc>>) ?? core.class.Doc
  const docs = await control.client.findAll(targetClass, {
    _id: { $in: targetIds as any }
  })
  if (docs.length === 0) {
    return ''
  }

  const hierarchy = control.client.getHierarchy()
  const allClasses = [targetClass]
  let currentClass = hierarchy.getClass(targetClass)
  while (currentClass?.extends !== undefined) {
    allClasses.push(currentClass.extends)
    currentClass = hierarchy.getClass(currentClass.extends)
  }

  const viewlets = await control.client.findAll(view.class.Viewlet, {
    attachTo: { $in: allClasses },
    descriptor: view.viewlet.Table
  })
  const viewlet: Viewlet | undefined =
    viewlets.find((v) => v.attachTo === targetClass) ??
    viewlets.find((v) => allClasses.includes(v.attachTo)) ??
    viewlets[0]

  let rawConfig: Array<string | BuildModelKey> | undefined
  let preferences: any[] = []
  if (viewlet !== undefined) {
    preferences = await control.client.findAll(view.class.ViewletPreference, {
      space: core.space.Workspace,
      attachedTo: viewlet._id
    })
    rawConfig = preferences.length > 0 && preferences[0].config.length > 0 ? preferences[0].config : viewlet.config
  }

  if (rawConfig === undefined || rawConfig.length === 0) {
    rawConfig = (['', 'createdBy', 'createdOn', 'modifiedBy', 'modifiedOn'] as Array<string | BuildModelKey>).filter(
      (key) => typeof key !== 'string' || key === '' || hierarchy.findAttribute(targetClass, key) !== undefined
    )
  }

  const hiddenKeys = new Set(viewlet?.configOptions?.hiddenKeys ?? ['content', 'description'])
  const columns: ColumnDef[] = []
  const firstTitleHandled = { value: false }

  for (const item of rawConfig) {
    const key = typeof item === 'string' ? item : item.key
    if (hiddenKeys.has(key)) continue
    if (typeof item === 'object' && item.displayProps?.grow === true) continue

    const col = await resolveHeaderLabel(item, targetClass, hierarchy, control, firstTitleHandled, 'en')
    if (col !== undefined) {
      columns.push(col)
    }
  }

  if (columns.length === 0) {
    columns.push({ key: '', label: 'Title', isTitle: true })
  }

  // Determine sorting:
  const explicitSort = parseSortingQuery(props.$sort ?? props.sort)
  const viewletSort =
    parseSortingQuery(preferences[0]?.viewOptions?.orderBy) ??
    parseSortingQuery(viewlet?.viewOptions?.orderBy) ??
    parseSortingQuery(viewlet?.options?.sort)

  let sortQuery = explicitSort ?? viewletSort

  if (sortQuery === undefined) {
    const allAttrs = hierarchy.getAllAttributes(targetClass)
    for (const [attrName, attrDef] of allAttrs) {
      const labelLower = String(attrDef.label ?? '').toLowerCase()
      if (attrName.toLowerCase() === 'order' || labelLower === 'order') {
        sortQuery = { [attrName]: 1 }
        break
      }
    }
    if (sortQuery === undefined) {
      for (const col of columns) {
        if (col.label.toLowerCase() === 'order') {
          sortQuery = { [col.customKey ?? col.key]: 1 }
          break
        }
      }
    }
    if (sortQuery === undefined && allAttrs.has('rank')) {
      sortQuery = { rank: 1 }
    }
  }

  if (sortQuery !== undefined && Object.keys(sortQuery).length > 0) {
    sortDocuments(docs, sortQuery)
  }

  // Preload lookup references for RefTo attributes (e.g. MasterTag, assignees, employees, references)
  const lookupCache = new Map<string, string>()
  for (const col of columns) {
    const attr = col.attr
    if (attr?.type !== undefined) {
      const isArray = attr.type._class === core.class.ArrOf
      const refType = isArray ? (attr.type as any).of : attr.type
      if (refType?._class === core.class.RefTo && refType.to !== undefined) {
        const toClass = refType.to as Ref<Class<Doc>>
        const idSet = new Set<string>()
        for (const doc of docs) {
          const valKey = col.customKey ?? col.key
          const val = (doc as any)[valKey]
          if (val === undefined || val === null) continue
          if (Array.isArray(val)) {
            for (const v of val) if (typeof v === 'string') idSet.add(v)
          } else if (typeof val === 'string') {
            idSet.add(val)
          }
        }
        if (idSet.size > 0) {
          const ids = Array.from(idSet)
          if (hierarchy.isDerived(toClass, contact.mixin.Employee)) {
            for (const id of ids) {
              try {
                const person = await getPersonByPersonRef(control.client, id as any)
                if (person != null) {
                  lookupCache.set(id, getName(hierarchy, person))
                }
              } catch {}
            }
          } else {
            try {
              const refDocs = await control.client.findAll(toClass, { _id: { $in: ids as any } })
              for (const rd of refDocs) {
                const titleOrName = (rd as any).title ?? (rd as any).name ?? (rd as any).label ?? (rd as any).identifier
                if (titleOrName != null) {
                  lookupCache.set(rd._id, await translateOrClean(titleOrName, 'en'))
                }
              }
            } catch {}

            for (const id of ids) {
              if (!lookupCache.has(id)) {
                const modelObj = control.client.getModel().findObject(id as Ref<any>)
                if (modelObj != null) {
                  const labelOrName = modelObj.label ?? modelObj.title ?? modelObj.name
                  if (labelOrName != null) {
                    lookupCache.set(id, await translateOrClean(labelOrName, 'en'))
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Preload association columns
  const assocCache = new Map<string, Map<string, string>>()
  for (const col of columns) {
    if (col.isAssoc) {
      const parts = col.key.split('.')
      let lastAssocIndex = -1
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === '$associations' && i + 1 < parts.length) {
          lastAssocIndex = i
        }
      }
      if (lastAssocIndex !== -1) {
        const fragments = parts[lastAssocIndex + 1].split('_')
        const assocId = fragments[0] as Ref<Association>
        const isA = fragments[1] === 'a'
        const docMap = new Map<string, string>()
        try {
          const docIds = docs.map((d) => d._id)
          const rels = await control.client.findAll(core.class.Relation, {
            association: assocId,
            [isA ? 'docB' : 'docA']: { $in: docIds as any }
          })
          const targetDocIds = Array.from(new Set(rels.map((r) => (isA ? r.docA : r.docB))))
          if (targetDocIds.length > 0) {
            const relatedDocs = await control.client.findAll(core.class.Doc, {
              _id: { $in: targetDocIds as any }
            })
            const relDocTitleMap = new Map<string, string>()
            for (const rd of relatedDocs) {
              const rIdentifier = (rd as any).identifier
              const rTitle = (rd as any).title
              const t =
                rIdentifier != null && rTitle != null
                  ? `${String(rIdentifier)}: ${String(rTitle)}`
                  : String((rd as any).title ?? (rd as any).name ?? (rd as any).identifier ?? '')
              relDocTitleMap.set(rd._id, t)
            }
            for (const r of rels) {
              const ourId = isA ? r.docB : r.docA
              const otherId = isA ? r.docA : r.docB
              const otherTitle = relDocTitleMap.get(otherId)
              if (otherTitle !== undefined && otherTitle !== '') {
                const prev = docMap.get(ourId)
                docMap.set(ourId, prev !== undefined && prev !== '' ? `${prev}, ${otherTitle}` : otherTitle)
              }
            }
          }
        } catch {}
        assocCache.set(col.key, docMap)
      }
    }
  }

  // Build rows
  const rows: string[][] = []
  for (const doc of docs) {
    const row: string[] = []
    for (const col of columns) {
      let cellText = ''
      if (col.isTitle) {
        const identifier: string | undefined = (doc as any).identifier
        const title: string = (doc as any).title ?? (doc as any).name ?? ''
        if (identifier !== undefined && identifier !== '' && title !== '') {
          cellText = `${identifier}: ${title}`
        } else {
          cellText = identifier ?? title
        }
      } else if (col.isTags) {
        cellText = getCardTags(doc, hierarchy)
      } else if (col.isAssoc) {
        cellText = assocCache.get(col.key)?.get(doc._id) ?? ''
      } else {
        const valKey = col.customKey ?? col.key
        const rawValue = (doc as any)[valKey]
        cellText = await formatCellValue(rawValue, col.attr, lookupCache)
      }
      row.push(escapeMarkdownTableCellContent(cellText))
    }
    rows.push(row)
  }

  // Render markdown table
  let markdown = '| ' + columns.map((c) => escapeMarkdownTableCellContent(c.label)).join(' | ') + ' |\n'
  markdown += '| ' + columns.map(() => '---').join(' | ') + ' |\n'
  for (const row of rows) {
    markdown += '| ' + row.join(' | ') + ' |\n'
  }

  const markupNode = markdownToMarkup(markdown)
  return jsonToMarkup(markupNode)
}
