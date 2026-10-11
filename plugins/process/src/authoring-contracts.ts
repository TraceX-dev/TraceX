//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import type { Doc, ModelDb, Ref } from '@hcengineering/core'
import { fail, list, object, text } from './authoring-validation'

export interface AuthoringOutputEnvironment {
  model?: ModelDb
  catalog?: Record<string, unknown>
}

/** Installed definitions are authoritative; catalogs supply offline contracts only. */
export function authoringOperationContract (
  id: string,
  kind: 'methods' | 'triggers' | 'functions',
  environment: AuthoringOutputEnvironment
): Record<string, unknown> | undefined {
  if (environment.model !== undefined) {
    return environment.model.findObject(id as Ref<Doc>) as unknown as Record<string, unknown> | undefined
  }
  const definitions = object(environment.catalog?.[kind] ?? {}, `catalog.${kind}`)
  const short = id.replace(/^process:(?:method|trigger|function):/, '')
  const value = Object.prototype.hasOwnProperty.call(definitions, id)
    ? definitions[id]
    : Object.prototype.hasOwnProperty.call(definitions, short)
      ? definitions[short]
      : undefined
  return value === undefined ? undefined : object(value, `catalog.${kind}.${id}`)
}

/** Checks only requirements declared by the model, without inventing types or defaults. */
export function validateAuthoringParameters (
  definition: Record<string, unknown> | undefined,
  params: unknown,
  path: string
): void {
  if (definition?.requiredParams === undefined) return
  const values = object(params, path)
  for (const key of list(definition.requiredParams, 'requiredParams')) {
    const name = text(key, 'requiredParams')
    if (
      !Object.prototype.hasOwnProperty.call(values, name) ||
      values[name] === undefined ||
      values[name] === null ||
      values[name] === ''
    ) {
      fail(`${path}.${name}`, 'Required parameter is missing; method defaults are not applied implicitly')
    }
  }
}
