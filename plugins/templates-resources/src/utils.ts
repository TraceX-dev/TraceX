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

import { type Class, type Doc, generateId, type Ref } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import templates, {
  templateFieldRegexp,
  type TemplateData,
  type TemplateDataProvider,
  type TemplateDataProviderOptions,
  type TemplateField,
  type TemplateFieldCategory
} from '@hcengineering/templates'

const templateData = new Map<Ref<TemplateFieldCategory>, TemplateData[]>()

class TemplateDataProviderImpl implements TemplateDataProvider {
  private readonly id = generateId()

  constructor (private readonly options: TemplateDataProviderOptions = {}) {}

  set (key: Ref<Class<Doc>>, value: any): void {
    const data = templateData.get(key) ?? []
    data.unshift({
      owner: this.id,
      data: value
    })
    templateData.set(key, data)
  }

  get (key: Ref<Class<Doc>>): any | undefined {
    const data = templateData.get(key) ?? []
    const current = data.find((p) => p.owner === this.id)
    return current?.data ?? (this.options.inheritContext === false ? undefined : data[0]?.data)
  }

  async fillTemplate (message: string): Promise<string> {
    const pattern = new RegExp(templateFieldRegexp.source, 'g')
    const matches = Array.from(message.matchAll(pattern))
    const values = new Map<string, string>()
    const client = getClient()
    for (const [, id] of matches) {
      if (values.has(id)) continue
      const field = await client.findOne(templates.class.TemplateField, { _id: id as Ref<TemplateField> })
      if (field === undefined) continue
      const resolve = await getResource(field.func)
      values.set(id, (await resolve(this)) ?? '')
    }
    return message.replace(pattern, (match, id: string) => values.get(id) ?? match)
  }

  destroy (): void {
    for (const key of templateData.keys()) {
      const data = templateData.get(key) ?? []
      const res = data.filter((p) => p.owner !== this.id)
      templateData.set(key, res)
    }
  }
}

export function getTemplateDataProvider (options?: TemplateDataProviderOptions): TemplateDataProviderImpl {
  return new TemplateDataProviderImpl(options)
}
