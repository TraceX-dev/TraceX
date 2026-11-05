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

import { resolve } from 'path'
import * as ts from 'typescript'

import { ACCOUNT_AUDIT_SPECS } from '../audit'

const sourcePaths = ['operations.ts', 'serviceOperations.ts', 'utils.ts'].map((name) => resolve(__dirname, '..', name))
const options: ts.CompilerOptions = {
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  types: []
}
const program = ts.createProgram(sourcePaths, options)
const checker = program.getTypeChecker()
const methods = new Map<string, ts.FunctionDeclaration>()
for (const path of sourcePaths) {
  const source = program.getSourceFile(path)
  if (source === undefined) throw new Error(`Missing source file: ${path}`)
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      methods.set(statement.name.text, statement)
    }
  }
}

test.each(Object.entries(ACCOUNT_AUDIT_SPECS))(
  '%s audit fields exist in the actual RPC parameter type',
  (name, spec) => {
    if (spec === undefined) throw new Error(`Missing audit spec: ${name}`)
    const method = methods.get(name)
    if (method === undefined) throw new Error(`No implementation found for audited method: ${name}`)
    const projectedKeys = [...Object.keys(spec.parameters ?? {}), ...Object.keys(spec.hashedParameters ?? {})]
    if (projectedKeys.length === 0) return
    // RPC parameters follow ctx, db, branding and token. Resolve interfaces as well as inline types.
    const parameter = method.parameters[4]
    if (parameter === undefined) throw new Error(`${name} has no RPC parameters`)
    const actualKeys = checker
      .getTypeAtLocation(parameter)
      .getProperties()
      .map((property) => property.name)
    expect(actualKeys.length).toBeGreaterThan(0)
    for (const key of projectedKeys) {
      if (!actualKeys.includes(key))
        {throw new Error(`${name}: unknown audit parameter ${key}; actual parameters: ${actualKeys.join(', ')}`)}
    }
  }
)
