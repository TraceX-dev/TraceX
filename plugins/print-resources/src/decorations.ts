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

import core, { type Client, type Doc, type Blob, type Ref } from '@hcengineering/core'
import { getMetadata, getResource } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'
import print, { selectPrintConfiguration, type PrintData } from '@hcengineering/print'
import { getCurrentLocation } from '@hcengineering/ui'
import setting from '@hcengineering/setting'
import templates, { templateFieldRegexp, type TemplateDataProvider } from '@hcengineering/templates'

export interface PrintDecoration {
  header: string
  footer: string
  printLogo: boolean
  data: PrintData
  workspace: string
  icon?: Ref<Blob>
}

/** Validate stored field identities independently of values available for one document. */
export async function validatePrintText (client: Client, texts: string[]): Promise<void> {
  const ids = new Set(
    texts.flatMap((text) => Array.from(text.matchAll(new RegExp(templateFieldRegexp.source, 'g')), (match) => match[1]))
  )
  const fields = await client.findAll(templates.class.TemplateField, {})
  const known = new Set<string>(fields.map((field) => field._id))
  for (const id of ids) {
    if (!known.has(id)) throw new Error('Unknown template field: ' + id)
  }
}

/** Shared registry field; domain providers supply the exact printable title. */
export async function printedObjectTitle (provider: TemplateDataProvider): Promise<string | undefined> {
  const value: unknown = provider.get(core.class.Doc)
  if (value !== null && typeof value === 'object' && 'title' in value && typeof value.title === 'string') {
    return value.title
  }
}

/** Resolve decorations against the actual document selected by its panel. */
export async function loadPrintDecoration (client: Client, object: Doc): Promise<PrintDecoration | undefined> {
  if (
    typeof window !== 'undefined' &&
    new URL(window.location.href).searchParams.get('printHeaderFooter') === 'false'
  ) {
    return
  }
  const mixin = client.getHierarchy().classHierarchyMixin(object._class, print.mixin.PrintConfig)
  if (mixin === undefined) return
  const configurations = await client.findAll(print.class.PrintConfiguration, {})
  const values = selectPrintConfiguration(client.getHierarchy(), object._class, configurations)
  if (values === undefined || !values.enabled) return
  await validatePrintText(client, [values.header, values.footer])
  const createProvider = await getResource(templates.function.GetTemplateDataProvider)
  const provider = createProvider({ inheritContext: false })
  try {
    const getData = await getResource(mixin.provider)
    const data = await getData(client, object, provider)
    provider.set(core.class.Doc, data)
    const header = await provider.fillTemplate(values.header)
    const footer = await provider.fillTemplate(values.footer)
    const ws = values.printLogo ? await client.findOne(setting.class.WorkspaceSetting, {}) : undefined
    return {
      ...values,
      header,
      footer,
      data,
      workspace: (getCurrentLocation().path[1] ?? getMetadata(presentation.metadata.WorkspaceName) ?? '').toUpperCase(),
      icon: ws?.icon ?? undefined
    }
  } finally {
    provider.destroy()
  }
}
