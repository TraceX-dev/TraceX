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

import core, {
  getObjectValue,
  type Class,
  type Doc,
  type Hierarchy,
  type Ref,
  type SearchResultDoc,
  type Space
} from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'

import plugin, {
  type FieldTemplate,
  type FieldTemplateComponent,
  type FieldTemplateParam,
  type IndexedDoc,
  type SearchPresenter,
  type SearchScoring
} from '@hcengineering/server-core'

export function findSearchPresenter (hierarchy: Hierarchy, _class: Ref<Class<Doc>>): SearchPresenter | undefined {
  try {
    const searchMixin = hierarchy.classHierarchyMixin(_class, plugin.mixin.SearchPresenter)
    if (searchMixin !== undefined) {
      return searchMixin
    }
  } catch (err: any) {
    // Ignore missing classes
  }
  return undefined
}

/**
 * @public
 */
export async function updateDocWithPresenter (
  hierarchy: Hierarchy,
  doc: Doc,
  elasticDoc: IndexedDoc,
  parentDoc: Doc | undefined,
  spaceDoc: Space | undefined,
  searchPresenter: SearchPresenter
): Promise<void> {
  const props: { name: string, config: FieldTemplateComponent | FieldTemplate }[] = [
    {
      name: 'searchTitle',
      config: searchPresenter.title
    }
  ]

  if (searchPresenter.shortTitle !== undefined) {
    props.push({
      name: 'searchShortTitle',
      config: searchPresenter.shortTitle
    })
  }

  if (searchPresenter.iconConfig !== undefined) {
    props.push({
      name: 'searchIcon',
      config: searchPresenter.iconConfig
    })
  }

  async function extractParam (f: FieldTemplateParam): Promise<any> {
    if (f.length === 1) {
      return getObjectValue(f[0], doc)
    }
    switch (f[0]) {
      case 'func': {
        const rf = await getResource(f[1])
        return rf(doc, parentDoc, spaceDoc, hierarchy, f[2])
      }
      case 'space':
        return spaceDoc !== undefined ? getObjectValue(f[1], spaceDoc) : ''
      case 'parent':
        return parentDoc !== undefined ? getObjectValue(f[1], parentDoc) : ''
    }
  }
  async function formatTemplate (template: FieldTemplate): Promise<string> {
    if (template === undefined) return ''
    let tValue = ''
    for (const t of template) {
      if (typeof t === 'string') {
        tValue += t
      } else {
        tValue += `${await extractParam(t)}`
      }
    }
    return tValue
  }

  for (const prop of props) {
    try {
      if (!Array.isArray(prop.config)) {
        if (prop.config?.fields !== undefined) {
          const params: string[] = []
          for (const f of prop.config.fields) {
            params.push(await extractParam(f))
          }
          elasticDoc[prop.name + '_fields'] = params
        }
        if (prop.config?.template !== undefined) {
          elasticDoc[prop.name] = await formatTemplate(prop.config.template)
        }
        if (prop.config?.extraFields !== undefined) {
          elasticDoc[prop.name + '_extra'] = []
          for (const t of prop.config.extraFields) {
            elasticDoc[prop.name + '_extra'].push(await formatTemplate(t))
          }
        }
      } else {
        elasticDoc[prop.name] = await formatTemplate(prop.config)
      }
    } catch (err: any) {
      console.error('failed to format template', err, prop, JSON.stringify(searchPresenter))
    }
  }
}

export function getScoringConfig (hierarchy: Hierarchy, classes: Ref<Class<Doc>>[]): SearchScoring[] {
  let results: SearchScoring[] = []
  for (const _class of classes) {
    const searchPresenter = findSearchPresenter(hierarchy, _class)
    if (searchPresenter?.scoring !== undefined) {
      results = results.concat(searchPresenter?.scoring)
    }
  }
  return results
}

/**
 * @public
 */
export function mapSearchResultDoc (hierarchy: Hierarchy, raw: IndexedDoc): SearchResultDoc {
  const doc: SearchResultDoc = {
    id: raw.id,
    title: raw.searchTitle,
    shortTitle: raw.searchShortTitle,
    doc: {
      _id: raw.id,
      _class: raw._class[0],
      createdOn: raw.createdOn,
      attachedTo: raw.attachedTo,
      attachedToClass: raw.attachedToClass,
      baseId: raw.baseId
    },
    score: raw._score
  }

  if (
    raw.version !== undefined &&
    hierarchy.classHierarchyMixin(doc.doc._class, core.mixin.VersionableClass)?.enabled === true
  ) {
    doc.description = `v${raw.version}`
  }

  function fUpper (name: string): string {
    return name[0].toUpperCase() + name.slice(1)
  }

  function toProps (comp: FieldTemplateComponent, values: any[]): Record<string, any> {
    const result: Record<string, any> = {}
    let pos = 0
    for (const f of comp.fields ?? []) {
      if (f.length === 1) {
        result[f[0]] = values[pos]
        pos++
      }
      if (f.length === 2) {
        result[f[0] + fUpper(f[1])] = values[pos]
        pos++
      }
    }
    return result
  }

  const searchPresenter = findSearchPresenter(hierarchy, doc.doc._class)
  if (searchPresenter !== undefined) {
    if (searchPresenter.searchIcon !== undefined) {
      doc.icon = searchPresenter.searchIcon
    }
    if (searchPresenter.iconConfig !== undefined) {
      doc.iconComponent = {
        component: searchPresenter.iconConfig.component,
        props: toProps(searchPresenter.iconConfig, raw.searchIcon_fields ?? [])
      }
    }
    if (!Array.isArray(searchPresenter.title)) {
      doc.titleComponent = {
        component: searchPresenter.title.component,
        props: toProps(searchPresenter.title, raw.searchTitle_fields ?? [])
      }
    }
    if (searchPresenter.shortTitle !== undefined && !Array.isArray(searchPresenter.shortTitle)) {
      doc.shortTitleComponent = {
        component: searchPresenter.shortTitle.component,
        props: toProps(searchPresenter.shortTitle, raw.searchShortTitle_fields ?? [])
      }
    }
  }

  return doc
}
