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

// Throwaway compatibility probe. Native edits below are not AI Toolkit execution.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const runtime = path.join(__dirname, '.runtime')
const results = path.join(__dirname, 'results')
const observations = []
const checks = []
const sourceHashes = {}

function snapshot (source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
  sourceHashes[path.relative(root, source)] = createHash('sha256').update(fs.readFileSync(source)).digest('hex')
}

function snapshotTree (source, target) {
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    if (item.name === '__tests__') continue
    const from = path.join(source, item.name)
    const to = path.join(target, item.name)
    if (item.isDirectory()) snapshotTree(from, to)
    else if (item.name.endsWith('.ts')) snapshot(from, to)
  }
}

function save (name, value) {
  fs.writeFileSync(path.join(results, name), JSON.stringify(value, null, 2) + '\n')
}

function check (name, fn) {
  try {
    fn()
    checks.push({ name, status: 'passed' })
  } catch (error) {
    checks.push({ name, status: 'failed', message: error.message })
  }
}

function walk (node, visit) {
  visit(node)
  for (const child of node.content ?? []) walk(child, visit)
}

function protectedValues (doc) {
  const values = []
  walk(doc, (node) => {
    if (['reference', 'image', 'embed', 'table'].includes(node.type)) values.push(node)
    for (const mark of node.marks ?? []) {
      if (['node-uuid', 'inline-comment'].includes(mark.type)) values.push(mark)
    }
  })
  return values
}

async function main () {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 20 && Number(process.versions.node.split('.')[0]) < 25,
    'Run with Node >=20 <25, matching the repository requirement')
  fs.mkdirSync(results, { recursive: true })
  fs.rmSync(path.join(results, 'failure.json'), { force: true })
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
  check('Installed Tiptap versions match the standalone manifest', () => {
    for (const [name, version] of Object.entries(manifest.dependencies)) {
      if (!name.startsWith('@tiptap/')) continue
      const installed = JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules', name, 'package.json'), 'utf8'))
      assert.equal(installed.version, version, `Run npm ci: ${name} has a stale installed version`)
    }
  })
  assert.equal(checks[0].status, 'passed', checks[0].message)
  snapshotTree(path.join(root, 'foundations/core/packages/text/src'), path.join(runtime, 'text'))
  snapshot(
    path.join(root, 'plugins/text-editor-resources/src/components/extension/qms/qmsInlineCommentMark.ts'),
    path.join(runtime, 'qms-mark.ts')
  )
  // Resolve the client's shared QMS import to the real snapshotted implementation.
  const sharedPackage = path.join(runtime, 'node_modules/@hcengineering/text')
  fs.mkdirSync(sharedPackage, { recursive: true })
  fs.writeFileSync(path.join(sharedPackage, 'package.json'), JSON.stringify({
    name: '@hcengineering/text', private: true, main: '../../../text/marks/qmsInlineCommentMark.ts'
  }))
  require('ts-node').register({
    transpileOnly: true,
    skipProject: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node', target: 'ES2022', esModuleInterop: true }
  })
  const { Editor, getSchema } = require('@tiptap/core')
  const { EditorState } = require('@tiptap/pm/state')
  const { Schema } = require('@tiptap/pm/model')
  const { getEditorContext, ServerAiToolkit } = require('@tiptap/ai-toolkit')
  const { z } = require('zod')
  const { ServerKit } = require(path.join(runtime, 'text/kits/server-kit.ts'))
  const { QMSInlineCommentMark } = require(path.join(runtime, 'qms-mark.ts'))
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'))
  const serverEditor = new Editor({ element: null, extensions: [ServerKit, ServerAiToolkit], content: fixture })
  const editor = new Editor({
    element: null,
    extensions: [ServerKit.configure({ qmsInlineCommentMark: false }), QMSInlineCommentMark, ServerAiToolkit],
    content: fixture
  })
  try {
    const serverDoc = serverEditor.getJSON()
    const doc = editor.getJSON()
    save('fixture.json', fixture)
    save('server-roundtrip.json', serverDoc)
    save('qms-profile-roundtrip.json', doc)
    const qmsMark = (value) => value.content[1].content[0].marks.find((mark) => mark.type === 'node-uuid')
    observations.push({
      name: 'QMS comment identity after native JSON round trip',
      status: JSON.stringify(qmsMark(serverDoc)) === JSON.stringify(qmsMark(fixture)) ? 'preserved' : 'lost',
      input: qmsMark(fixture),
      serverKitWithoutToolkit: qmsMark(getSchema([ServerKit]).nodeFromJSON(fixture).toJSON()),
      serverKit: qmsMark(serverDoc), clientQmsProfile: qmsMark(doc)
    })
    check('Headless ServerKit loads with the public AI extension', () => serverEditor.state.doc.check())
    check('The default server schema preserves QMS identities with and without Toolkit', () => {
      assert.equal(JSON.stringify(qmsMark(serverDoc)), JSON.stringify(qmsMark(fixture)))
      const plainServer = getSchema([ServerKit]).nodeFromJSON(fixture)
      plainServer.check()
      assert.equal(JSON.stringify(qmsMark(plainServer.toJSON())), JSON.stringify(qmsMark(fixture)))
    })
    check('Profile using the real client QMS mark preserves its comment identity', () => {
      assert.equal(JSON.stringify(qmsMark(doc)), JSON.stringify(qmsMark(fixture)))
      editor.state.doc.check()
    })
    check('Reference and image resource attributes survive normalization', () => {
      const input = fixture.content[1].content
      const output = doc.content[1].content
      for (const index of [2, 3]) {
        for (const [key, value] of Object.entries(input[index].attrs)) assert.deepEqual(output[index].attrs[key], value)
      }
    })

    const baselineContext = getEditorContext(editor)
    const customNodes = [
      {
        extensionName: 'reference', name: 'TraceX document reference',
        description: 'Inline reference to an existing TraceX document. Preserve its target identity; this tool does not allocate resource IDs.',
        attributes: { id: z.string(), objectclass: z.string(), label: z.string(), fixed: z.boolean().nullable().optional() }
      },
      {
        extensionName: 'image', name: 'TraceX stored image',
        description: 'Image backed by an existing attachment. Preserve file-id; uploading or allocating a file is outside content editing.',
        attributes: { 'file-id': z.string().nullable(), src: z.string().nullable(), width: z.union([z.string(), z.number(), z.null()]), display: z.enum(['block', 'inline']).nullable() }
      },
      {
        extensionName: 'node-uuid', name: 'QMS comment anchor', isMark: true,
        description: 'Existing QMS comment identity. Preserve the mark and its node-uuid; do not invent or reassign comment identities.',
        attributes: { 'node-uuid': z.string().nullable() }
      },
      {
        extensionName: 'inline-comment', name: 'TraceX inline comment anchor', isMark: true,
        description: 'Existing inline comment thread. Preserve its thread identifier.',
        attributes: { thread: z.string() }
      }
    ]
    const context = getEditorContext(editor, { customNodes })
    save('editor-context-baseline.json', baselineContext)
    save('editor-context-enriched.json', context)
    check('Stored editor context reconstructs a native schema preserving the fixture', () => {
      const stored = JSON.parse(JSON.stringify(context))
      const schema = new Schema(stored.serializedSchema)
      const restored = schema.nodeFromJSON(doc)
      restored.check()
      assert.equal(JSON.stringify(restored.toJSON()), JSON.stringify(doc))
    })
    check('Explicit custom node metadata reaches editor context', () => {
      const serialized = JSON.stringify(context)
      assert.ok(serialized.includes('TraceX document reference'))
      assert.ok(serialized.includes('QMS comment anchor'))
      const image = context.items.find((item) => item.extensionName === 'image')
      assert.ok(JSON.stringify(image.attributes).includes('block'))
      assert.ok(JSON.stringify(image.attributes).includes('inline'))
    })
    const ownedMetadataEditor = new Editor({
      element: null,
      extensions: [
        ServerKit.configure({ qmsInlineCommentMark: false }),
        QMSInlineCommentMark.extend({
          addJsonSchemaAwareness () {
            return {
              name: 'Extension-owned QMS anchor',
              description: 'Preserve this existing comment identity.',
              attributes: { 'node-uuid': z.string().nullable() }
            }
          }
        }),
        ServerAiToolkit
      ],
      content: fixture
    })
    try {
      const owned = getEditorContext(ownedMetadataEditor)
      save('editor-context-extension-owned.json', owned)
      check('Metadata can live on the owning custom extension', () => {
        const item = owned.items.find((item) => item.extensionName === 'node-uuid')
        assert.equal(item.name, 'Extension-owned QMS anchor')
        assert.equal(item.isMark, true)
      })
    } finally {
      ownedMetadataEditor.destroy()
    }
    observations.push({ name: 'Editor context size', baselineBytes: Buffer.byteLength(JSON.stringify(baselineContext)), enrichedBytes: Buffer.byteLength(JSON.stringify(context)) })
    const missingDescriptions = (value) => {
      const described = new Set(value.items.map((item) => item.extensionName))
      return [...Object.keys(value.serializedSchema.nodes), ...Object.keys(value.serializedSchema.marks)]
        .filter((name) => !described.has(name))
    }
    observations.push({ name: 'Schema types without semantic descriptions', baseline: missingDescriptions(baselineContext), enriched: missingDescriptions(context) })

    // These transactions are deterministic local probes, not vendor AI tool calls.
    let state = EditorState.create({ doc: editor.state.doc })
    state = state.apply(state.tr.insert(0, state.schema.nodes.paragraph.create(null, state.schema.text('Inserted before protected content.'))))
    check('Native insertion before protected content preserves identities and the table', () => {
      assert.deepEqual(protectedValues(state.doc.toJSON()), protectedValues(doc))
      state.doc.check()
    })
    let start
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Final paragraph.') start = pos
    })
    assert.notEqual(start, undefined)
    state = state.apply(state.tr.insertText('Rewritten final paragraph.', start, start + 'Final paragraph.'.length))
    check('Native text replacement leaves unrelated custom nodes and marks intact', () => {
      assert.deepEqual(protectedValues(state.doc.toJSON()), protectedValues(doc))
      state.doc.check()
    })
    save('after-native-edits.json', state.doc.toJSON())
    check('Unknown node types are rejected by native parsing', () => {
      assert.throws(() => editor.schema.nodeFromJSON({ type: 'invented-prototype-node' }))
    })
    check('Invalid table nesting is rejected by native validation', () => {
      assert.throws(() => editor.schema.nodeFromJSON({ type: 'doc', content: [{ type: 'table', content: [{ type: 'paragraph' }] }] }).check())
    })
    observations.push({ name: 'Unknown attributes are not a validation guarantee', explanation: 'Native JSON parsing can discard attributes absent from the schema; successful parsing alone does not prove losslessness.' })

    const live = { status: 'not_run', reason: 'Paid API access is required. Use --live and TIPTAP_AI_TOKEN to execute the vendor tools.' }
    if (process.argv.includes('--live')) {
      const token = process.env.TIPTAP_AI_TOKEN
      assert.ok(token, 'Set TIPTAP_AI_TOKEN to a Tiptap Access Control JWT with AI:Toolkit permission')
      const base = process.env.TIPTAP_AI_URL ?? 'https://api.tiptap.dev'
      const request = async (endpoint, body) => {
        const response = await fetch(new URL(`/v4/ai/toolkit/${endpoint}`, base), {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body), signal: AbortSignal.timeout(30000)
        })
        const result = await response.json()
        if (!response.ok) throw new Error(`Tiptap ${endpoint}: HTTP ${response.status}, code ${result.error?.code ?? 'unknown'}`)
        return result
      }
      const definitions = await request('fetch-tools', { editorContext: context, tools: { tiptapQuery: true }, format: 'json' })
      save('live-tool-definitions.json', definitions)
      const response = await request('execute-tool', {
        editorContext: context, document: { type: 'inline', content: doc }, format: 'json',
        tool: { name: 'tiptapQuery', input: { operations: [{ selector: [{ text: 'Final paragraph.' }], action: { type: 'replace', content: 'Edited by the real Tiptap API.' }, expect: 1 }] } }
      })
      save('live-edit-response.json', response)
      check('Real vendor tool executes successfully against inline JSON', () => {
        assert.equal(response.tool.output.success, true)
        assert.equal(response.docChanged, true)
        assert.ok(response.document)
      })
      if (response.document) {
        check('Vendor-edited document is native-schema valid and preserves identities', () => {
          editor.schema.nodeFromJSON(response.document).check()
          const withoutHashes = (value) => JSON.parse(JSON.stringify(value, (key, item) => key === '_hash' ? undefined : item))
          assert.deepEqual(withoutHashes(protectedValues(response.document)), withoutHashes(protectedValues(doc)))
        })
      }
      live.status = checks.some((item) => item.status === 'failed') ? 'failed' : 'passed'
      delete live.reason
    }
    const report = {
      date: new Date().toISOString(), node: process.version,
      versions: { tiptap: JSON.parse(fs.readFileSync(path.resolve(require.resolve('@tiptap/core'), '../../package.json'), 'utf8')).version, toolkit: '0.4.1' },
      scope: 'Actual shared ServerKit source plus the real client QMS mark. Not the full browser editor or a live collaborator.',
      checks, observations, live, sourceHashes
    }
    save('report.json', report)
    for (const item of checks) console.log(`${item.status.toUpperCase()} ${item.name}${item.message ? ': ' + item.message : ''}`)
    console.log(JSON.stringify({ observations, live, results }, null, 2))
    if (checks.some((item) => item.status === 'failed')) process.exitCode = 1
  } finally {
    serverEditor.destroy()
    editor.destroy()
  }
}

main().catch((error) => {
  fs.mkdirSync(results, { recursive: true })
  save('failure.json', { message: error.message, checks, observations })
  console.error(error.message)
  process.exitCode = 1
})
