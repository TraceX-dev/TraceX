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

import assert from 'node:assert/strict'
import fs from 'node:fs'
import Module, { createRequire } from 'node:module'
import * as typebox from 'typebox'
import * as schemaModule from 'typebox/schema'

// Run real TypeBox outside Jest's simplified schema shims, on every supported Node version.
const fromPackage = createRequire(new URL('../../../../package.json', import.meta.url))
const fromHere = createRequire(import.meta.url)
const ts = fromPackage('typescript')
const originalLoad = Module._load
const toolsPath = fromPackage.resolve('../ai-core/src/tools/tools.ts')
Module._load = function (name, parent, isMain) {
  if (name === 'typebox') return { __esModule: true, ...typebox }
  if (name === 'typebox/schema') return { __esModule: true, ...schemaModule }
  if (name === '@hcengineering/ai-core') return originalLoad.call(this, toolsPath, parent, isMain)
  return originalLoad.call(this, name, parent, isMain)
}
fromHere.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename
  })
  module._compile(result.outputText, filename)
}

const common = fromHere('../schema.ts')
const apply = fromHere('../collab.apply.ts')
const find = fromHere('../collab.find.ts')
const read = fromHere('../collab.read.ts')
const outline = fromHere('../collab.outline.ts')
const model = fromHere('../collab.schema.ts')
const { collabTools } = fromHere('../index.ts')
let checks = 0
function check (schema, value, expected = true) {
  // Check the serialized wire schema, including recursive references.
  const validator = schemaModule.Compile(JSON.parse(JSON.stringify(schema)))
  assert.equal(validator.Check(value), expected, JSON.stringify(value))
  checks++
}
for (const exports of [common, apply, find, read, outline, model]) {
  for (const [name, schema] of Object.entries(exports)) {
    if (!name.endsWith('Schema')) continue
    assert.equal(typeof schema.description, 'string', name)
    assert.ok(schema.description.trim().length > 0, name)
    checks++
  }
}
assert.deepEqual(collabTools.map((tool) => tool.name), [
  'collab.schema', 'collab.outline', 'collab.find', 'collab.read', 'collab.apply'
])
checks++

const docName = 'workspace|class|document|content'
const ref = 'a.0'
const hash = 'subtree-hash'
const summary = { ref, type: 'paragraph', preview: 'Hello', hash, childCount: 1 }
const node = { type: 'paragraph', content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }] }
check(common.DocNameSchema, docName)
check(common.DocNameSchema, 'document-id', false)
check(common.NodeRefSchema, ref)
check(common.NodeRefSchema, '$alias', false)
check(common.NodeRefSchema, 'root', false)
check(common.NodeRefSchema, 'aX0', false)
check(common.PositionSchema, { ref: 'root', where: 'end' })
check(common.NodeJsonSchema, node)
check(common.NodeJsonSchema, { type: 'paragraph', content: [{ type: 'text', text: 42 }] }, false)
check(find.CollabFindInputSchema, { docName, type: 'heading' })
check(find.CollabFindInputSchema, { docName, text: 'Hello', from: 0, limit: 200 })
check(find.CollabFindInputSchema, { docName }, false)
check(find.CollabFindInputSchema, { docName, text: '' }, false)
check(find.CollabFindInputSchema, { docName, type: 'heading', limit: 201 }, false)
check(outline.CollabOutlineInputSchema, { docName, from: -1 }, false)
check(outline.CollabOutlineOutputSchema, { total: 1, from: 0, rows: [summary] })
check(read.CollabReadOutputSchema, { ref, hash, node, children: [] })
check(read.CollabReadOutputSchema, {}, false)

const ops = [
  { op: 'insert_node', at: { ref: 'root', where: 'end' }, node },
  { op: 'update_attrs', ref, attrs: { textAlign: null } },
  { op: 'replace_text', ref, search: 'Hello', replace: 'Hi' },
  { op: 'delete_node', ref, expect: { hash } },
  { op: 'add_mark', ref, search: 'Hello', mark: { type: 'bold' } },
  { op: 'remove_mark', ref, search: 'Hello', mark: 'bold' }
]
for (const op of ops) check(apply.CollabApplyInputSchema, { docName, ops: [op] })
for (const op of [
  { op: 'delete_node', ref },
  { op: 'delete_node', ref, expect: {} },
  { op: 'move_node', ref, at: { ref: 'root', where: 'end' } },
  { ...ops[0], as: '$created' },
  { op: 'update_attrs', ref: '$created', attrs: { checked: true } }
]) check(apply.CollabApplyInputSchema, { docName, ops: [op] }, false)
check(apply.CollabApplyInputSchema, { docName, ops: [] }, false)
check(apply.CollabApplyInputSchema, { docName, ops: Array.from({ length: 101 }, () => ops[2]) }, false)
check(apply.CollabApplyOutputSchema, { ok: true, results: [{ opIndex: 0, ref, hash }, { opIndex: 1, deleted: true }] })
check(apply.CollabApplyOutputSchema, { ok: false, opIndex: 0, error: { code: 'STALE_REFERENCE', message: 'Read again.' } })
check(apply.CollabApplyOutputSchema, { ok: true, results: [{ opIndex: 0 }] }, false)

const { Awareness, getEditorContext } = fromPackage('../../../foundations/core/packages/text-agent/src/index.ts')
const { ServerKit } = fromPackage('../../../foundations/core/packages/text/src/kits/server-kit.ts')
check(model.CollabSchemaOutputSchema, getEditorContext(new Awareness([ServerKit])))

const context = { ctx: { warn: () => {} } }
const inputByName = {
  'collab.schema': {}, 'collab.outline': { docName }, 'collab.find': { docName, type: 'heading' },
  'collab.read': { docName, ref }, 'collab.apply': { docName, ops: [ops[2]] }
}
for (const tool of collabTools) {
  assert.ok(tool.description.length > 0)
  const result = await tool.execute(inputByName[tool.name], context)
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'not_implemented', message: 'Collaborative document tools are not connected to the collaborator yet.', retryable: false }
  })
  checks++
}
process.stdout.write(JSON.stringify({ checks }))
