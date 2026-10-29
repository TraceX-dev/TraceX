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

import type { Doc, ModelDb } from '@hcengineering/core'
import { JSON_SCHEMA, load, YAMLException } from 'js-yaml'
import { assertTree, fail, object, ProcessAuthoringError } from './authoring-validation'
import type { AuthoringValidation } from './authoring-validation'
import { compileAuthoringModel } from './authoring-model'
import { AuthoringSource } from './authoring-source'

export { ProcessAuthoringError } from './authoring-validation'

/** Native import documents omit runtime transaction metadata. */
export interface AuthoringNativeDocument {
  _id: string
  _class: string
  space: string
  [key: string]: unknown
}

export interface ProcessAuthoringResult {
  kind: 'card' | 'process'
  version: 2
  docs: AuthoringNativeDocument[]
}

/** Compiles the YAML authoring format into native card modules or portable process templates. */
export function compileProcessYaml (source: string, model?: ModelDb): ProcessAuthoringResult {
  if (source.length > 1024 * 1024 || new TextEncoder().encode(source).byteLength > 1024 * 1024) {
    fail('$', 'Authoring document exceeds 1 MiB')
  }
  const locations = new AuthoringSource(source)
  let value: unknown
  try {
    value = load(source, { schema: JSON_SCHEMA, listener: locations.listener })
  } catch (error) {
    if (error instanceof YAMLException) {
      throw new ProcessAuthoringError(
        '$',
        error.message,
        error.mark?.line === undefined ? undefined : error.mark.line + 1,
        error.mark?.column === undefined ? undefined : error.mark.column + 1
      )
    }
    throw error
  }
  try {
    assertTree(value)
    const root = object(value, '$')
    if (root.version !== 2) fail('version', 'Only version: 2 is supported; use the named-block YAML authoring format')
    return compileAuthoringModel(root, model)
  } catch (error) {
    if (error instanceof ProcessAuthoringError && error.line === undefined) {
      const mark = locations.location(value, error.path)
      if (mark !== undefined) {
        throw new ProcessAuthoringError(error.path, error.message.slice(error.path.length + 2), mark.line, mark.column)
      }
    }
    throw error
  }
}

/** Reads existing native JSON unchanged, or compiles YAML for the requested import route. */
export function parseProcessImport (source: string, kind: 'card' | 'process', model?: ModelDb): Doc[] {
  if (source.trimStart().startsWith('[')) return JSON.parse(source) as Doc[]
  const result = compileProcessYaml(source, model)
  if (result.kind !== kind) {
    fail('kind', `Use the ${result.kind === 'card' ? 'card module' : 'process'} importer for this document`)
  }
  if (kind === 'process') assertSingleProcess(result)
  return result.docs as unknown as Doc[]
}

/** Validates source for the authoring UI without writing model documents. */
export function validateProcessYaml (source: string, kind?: 'card' | 'process', model?: ModelDb): AuthoringValidation {
  try {
    const result = compileProcessYaml(source, model)
    if (kind !== undefined && result.kind !== kind) fail('kind', `Expected a ${kind} definition in this editor`)
    if (kind === 'process') assertSingleProcess(result)
    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      diagnostic: {
        message: error instanceof Error ? error.message : String(error),
        path: error instanceof ProcessAuthoringError ? error.path : '$',
        ...(error instanceof ProcessAuthoringError ? { line: error.line, column: error.column } : {})
      }
    }
  }
}

function assertSingleProcess (definition: ProcessAuthoringResult): void {
  if (definition.docs.filter((doc) => doc._class === 'process:class:Process').length !== 1) {
    fail('processes', 'This editor imports one process; install process bundles through Marketplace')
  }
}
