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

// Throwaway comparison using installed application dependencies and synthetic documents.
// This is not a production reference format, UUID extension, or collaboration executor.
const assert = require('node:assert/strict')
const { randomUUID, createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '../..')
const fromEditor = createRequire(path.join(root, 'plugins/text-editor-resources/package.json'))
const fromText = createRequire(path.join(root, 'foundations/core/packages/text/package.json'))
const ts = fromText('typescript')
// The runtime loader is local to this throwaway process and needs no extra packages.
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true
    },
    fileName: filename
  })
  module._compile(result.outputText, filename)
}
const { Extension, getSchema } = fromEditor('@tiptap/core')
const { EditorState } = fromEditor('@tiptap/pm/state')
const Y = fromEditor('yjs')
const binding = fromEditor('@tiptap/y-tiptap')
const { ServerKit } = fromText('./src/kits/server-kit.ts')
assert.equal(fromEditor('@tiptap/core').Node, fromText('@tiptap/core').Node,
  'Application packages must resolve to the same Tiptap core')

const TARGET_UUID = '00000000-0000-4000-8000-000000000002'
const ORIGIN = 'identity-comparison-prototype'
const cases = []
const evidence = {}
const reconciliationFailures = []
let passed = 0
let activeScenario = ''

const Uuids = Extension.create({
  name: 'prototypeBlockUuids',
  addGlobalAttributes () {
    return [{
      types: ['paragraph', 'heading', 'blockquote'],
      attributes: { blockUuid: { default: null, keepOnSplit: false } }
    }]
  }
})
const schema = getSchema([ServerKit, Uuids])

function verify (condition, message) {
  assert.ok(condition, message)
  passed++
}

function elements (fragment) {
  const result = []
  for (const child of fragment.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue
    result.push(child, ...elements(child))
  }
  return result
}

function fixture (withUuids = true) {
  return {
    type: 'doc',
    content: ['Alpha', 'Target text', 'Omega'].map((text, index) => ({
      type: 'paragraph',
      ...(withUuids ? { attrs: { blockUuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` } } : {}),
      content: [{ type: 'text', text }]
    }))
  }
}

function create (json = fixture()) {
  const doc = new Y.Doc({ gc: false })
  binding.prosemirrorToYXmlFragment(schema.nodeFromJSON(json), doc.getXmlFragment('content'))
  return doc
}

function reload (doc) {
  const copy = new Y.Doc({ gc: false })
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  return copy
}

function makeRef (element) {
  // Associate with the start of the container rather than with its first text child.
  return Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(element, 0, -1))).toString('base64url')
}

function rawResolve (doc, ref) {
  return Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(Buffer.from(ref, 'base64url')), doc
  )?.type ?? null
}

function resolveRef (doc, ref) {
  const target = rawResolve(doc, ref)
  return elements(doc.getXmlFragment('content')).includes(target) ? target : null
}

function byUuid (doc, id = TARGET_UUID) {
  return elements(doc.getXmlFragment('content')).filter((element) => element.getAttribute('blockUuid') === id)
}

function pm (doc) {
  return binding.initProseMirrorDoc(doc.getXmlFragment('content'), schema)
}

function json (doc) {
  return binding.yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('content'))
}

function apply (doc, prepare) {
  const initial = pm(doc)
  const state = EditorState.create({ doc: initial.doc })
  const tr = prepare(state.tr, state.doc)
  tr.doc.check()
  doc.transact(() => binding.updateYFragment(doc, doc.getXmlFragment('content'), tr.doc, initial.meta), ORIGIN)
  const actual = pm(doc).doc
  if (!actual.eq(tr.doc)) {
    const mismatch = { scenario: activeScenario, expected: tr.doc.toJSON(), actual: actual.toJSON() }
    reconciliationFailures.push(mismatch)
    console.log(JSON.stringify({ reconciliationMismatch: mismatch }, null, 2))
  }
  verify(actual.eq(tr.doc), 'The native operation must produce the requested document')
}

function block (doc, index = 1) {
  let pos = 0
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
  return { node: doc.child(index), pos }
}

function observe (name, doc, ref, extra = {}) {
  const resolved = resolveRef(doc, ref)
  const uuids = byUuid(doc)
  if (resolved !== null && uuids.length === 1) {
    verify(resolved === uuids[0], 'A successful native lookup must identify the same live node as the unique UUID')
  }
  const result = {
    name,
    ref: resolved === null ? 'not_found' : 'found',
    uuid: uuids.length === 0 ? 'not_found' : uuids.length === 1 ? 'found' : 'ambiguous',
    uuidMatches: uuids.length,
    refAndUniqueUuidResolveSameNode: uuids.length === 1 ? resolved === uuids[0] : null,
    refTarget: resolved?.toString() ?? null,
    uuidTargets: uuids.map((element) => element.toString()),
    ...extra
  }
  cases.push(result)
  return result
}

function scenario (name, operation) {
  activeScenario = name
  const doc = create()
  const target = doc.getXmlFragment('content').get(1)
  const ref = makeRef(target)
  try {
    operation(doc, ref, target)
    return observe(name, doc, ref)
  } finally {
    doc.destroy()
  }
}

function moveSecondToStart (tr, current) {
  const target = block(current)
  return tr.delete(target.pos, target.pos + target.node.nodeSize).insert(0, target.node)
}

function moveSecondToEnd (tr, current) {
  const target = block(current)
  tr.delete(target.pos, target.pos + target.node.nodeSize)
  return tr.insert(tr.doc.content.size, target.node)
}

function main () {
  scenario('text_and_marks', (doc) => apply(doc, (tr, current) => {
    const target = block(current)
    return tr.insertText('Edited ', target.pos + 1)
      .addMark(target.pos + 1, target.pos + 7, schema.marks.bold.create())
  }))
  scenario('replace_entire_text', (doc) => apply(doc, (tr, current) => {
    const target = block(current)
    return tr.insertText('Entirely rewritten text', target.pos + 1, target.pos + target.node.nodeSize - 1)
  }))
  scenario('insert_sibling_before', (doc) => apply(doc, (tr, current) =>
    tr.insert(block(current).pos, schema.nodes.paragraph.create({ blockUuid: randomUUID() }, schema.text('Inserted')))))
  scenario('update_attrs', (doc) => {
    const originalText = doc.getXmlFragment('content').get(1).get(0)
    apply(doc, (tr, current) => {
      const target = block(current)
      return tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, textAlign: 'center' })
    })
    verify(doc.getXmlFragment('content').get(1).get(0) === originalText,
      'An attribute update must preserve the original shared text type')
  })
  scenario('change_paragraph_to_heading', (doc) => apply(doc, (tr, current) => {
    const target = block(current)
    return tr.setNodeMarkup(target.pos, schema.nodes.heading, { ...target.node.attrs, level: 2 })
  }))
  scenario('binary_reload', (doc, ref) => {
    const copy = reload(doc)
    try {
      const result = observe('binary_reload_copy', copy, ref)
      verify(result.ref === 'found' && result.uuid === 'found', 'Both identities must survive binary persistence')
    } finally { copy.destroy() }
  })
  scenario('json_export_import_original', (doc, ref) => {
    const copy = create(json(doc))
    try {
      const result = observe('json_export_import_copy', copy, ref)
      verify(result.ref === 'not_found' && result.uuid === 'found', 'JSON rebuild creates new CRDT identities but retains declared UUID attrs')
    } finally { copy.destroy() }
  })
  const deleted = scenario('delete_target', (doc, ref) => {
    apply(doc, (tr, current) => {
      const target = block(current)
      return tr.delete(target.pos, target.pos + target.node.nodeSize)
    })
    evidence.deletedRefRawResolverStillReturnsType = rawResolve(doc, ref) !== null
  })
  verify(deleted.ref === 'not_found' && deleted.uuid === 'not_found', 'A deleted node must not be addressable through either guarded lookup')

  const copied = scenario('copy_without_uuid_policy', (doc) => apply(doc, (tr, current) =>
    tr.insert(current.content.size, schema.nodeFromJSON(block(current).node.toJSON()))))
  verify(copied.ref === 'found' && copied.uuid === 'ambiguous', 'Copying native JSON duplicates the UUID without an explicit policy')
  scenario('copy_with_fresh_uuid', (doc) => apply(doc, (tr, current) => {
    const copied = structuredClone(block(current).node.toJSON())
    copied.attrs.blockUuid = randomUUID()
    return tr.insert(current.content.size, schema.nodeFromJSON(copied))
  }))
  const split = scenario('native_split_without_uuid_policy', (doc) => apply(doc, (tr, current) =>
    tr.split(block(current).pos + 1 + 'Target'.length)))
  verify(split.uuid === 'ambiguous', 'Raw ProseMirror split copies attrs; Tiptap keepOnSplit is not a ProseMirror rule')
  scenario('split_with_explicit_uuid_policy', (doc) => apply(doc, (tr, current) => {
    const target = block(current)
    return tr.split(target.pos + 1 + 'Target'.length, 1, [{
      type: target.node.type, attrs: { ...target.node.attrs, blockUuid: randomUUID() }
    }])
  }))
  scenario('join_target_into_previous', (doc) => apply(doc, (tr, current) => tr.join(block(current).pos)))
  scenario('delete_insert_move', (doc) => apply(doc, moveSecondToStart))
  scenario('move_target_to_end', (doc) => apply(doc, moveSecondToEnd))
  scenario('move_using_cloned_node', (doc) => apply(doc, (tr, current) => {
    const target = block(current)
    const copied = schema.nodeFromJSON(structuredClone(target.node.toJSON()))
    return tr.delete(target.pos, target.pos + target.node.nodeSize).insert(0, copied)
  }))

  for (const mode of ['concurrent_text_edits', 'concurrent_move_and_text', 'concurrent_move_to_end_and_text']) {
    scenario(mode, (doc, ref) => {
      const peer = reload(doc)
      try {
        apply(doc, mode === 'concurrent_move_and_text' ? moveSecondToStart : mode === 'concurrent_move_to_end_and_text' ? moveSecondToEnd : (tr, current) => {
          const target = block(current)
          return tr.insertText(' [agent]', target.pos + target.node.nodeSize - 1)
        })
        apply(peer, (tr, current) => tr.insertText('[human] ', block(current).pos + 1))
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer))
        Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
        verify(JSON.stringify(json(doc)) === JSON.stringify(json(peer)), 'Concurrent replicas must converge')
        const visible = JSON.stringify(json(doc))
        evidence[mode] = {
          humanTextVisible: visible.includes('[human]'),
          ...(mode === 'concurrent_text_edits' ? { agentTextVisible: visible.includes('[agent]') } : {})
        }
        if (mode === 'concurrent_text_edits') {
          verify(visible.includes('[human]') && visible.includes('[agent]'), 'Ordinary concurrent text edits must both remain visible')
          verify(resolveRef(doc, ref) !== null, 'Ordinary concurrent edits must retain the native block reference')
        }
      } finally { peer.destroy() }
    })
  }

  const legacy = create(fixture(false))
  const legacyPeer = reload(legacy)
  try {
    const ref = makeRef(legacy.getXmlFragment('content').get(1))
    let updates = 0
    legacy.on('update', () => { updates++ })
    verify(resolveRef(legacy, ref) !== null, 'Legacy blocks must be addressable without UUID initialization')
    verify(updates === 0, 'Reading a native reference must not mutate the document')
    observe('legacy_before_uuid_initialization', legacy, ref)
    const first = randomUUID()
    const second = randomUUID()
    const assign = (id) => (tr, current) => {
      const target = block(current)
      return tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, blockUuid: id })
    }
    apply(legacy, assign(first))
    apply(legacyPeer, assign(second))
    Y.applyUpdate(legacy, Y.encodeStateAsUpdate(legacyPeer))
    Y.applyUpdate(legacyPeer, Y.encodeStateAsUpdate(legacy))
    const firstCount = byUuid(legacy, first).length
    const secondCount = byUuid(legacy, second).length
    verify(firstCount + secondCount === 1, 'Concurrent UUID initialization must have one winning attribute value')
    verify(resolveRef(legacy, ref) !== null, 'UUID initialization must not invalidate the native block reference')
    evidence.concurrentUuidInitialization = {
      bothReplicasConverged: JSON.stringify(json(legacy)) === JSON.stringify(json(legacyPeer)),
      onePreviouslyIssuedUuidNoLongerResolves: firstCount === 0 || secondCount === 0,
      initializationEmittedUpdates: updates > 0,
      nativeRefStillValid: true
    }
  } finally {
    legacy.destroy()
    legacyPeer.destroy()
  }

  const sample = create()
  try {
    evidence.sampleTokenBytes = {
      nativeContainerRefBase64url: Buffer.byteLength(makeRef(sample.getXmlFragment('content').get(1))),
      uuid: Buffer.byteLength(TARGET_UUID),
      note: 'Unscoped sample payloads; the final public ref must additionally bind the document and field'
    }
  } finally { sample.destroy() }
  const versions = {}
  for (const name of ['@tiptap/core', '@tiptap/y-tiptap', 'yjs']) {
    versions[name] = JSON.parse(fs.readFileSync(path.join(root, 'plugins/text-editor-resources/node_modules', name, 'package.json'), 'utf8')).version
  }
  const report = {
    date: new Date().toISOString(), node: process.version, versions, gc: false,
    scope: 'Synthetic valid paragraphs using the real shared ServerKit plus a prototype UUID attribute. No Hocuspocus transport, browser cursor or workspace data.',
    nativeOperations: 'ProseMirror transactions reconciled to the existing Y.Doc through @tiptap/y-tiptap updateYFragment with its initial mapping.',
    checksPassed: passed, cases, evidence, reconciliationFailures,
    schemaSourceSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'foundations/core/packages/text/src/kits/server-kit.ts'))).digest('hex')
  }
  const results = path.join(__dirname, 'results')
  fs.mkdirSync(results, { recursive: true })
  fs.writeFileSync(path.join(results, 'identity-comparison.json'), JSON.stringify(report, null, 2) + '\n')
  console.table(cases.map(({ name, ref, uuid, uuidMatches }) => ({ name, ref, uuid, uuidMatches })))
  console.log(JSON.stringify({ versions, checksPassed: passed, evidence }, null, 2))
}

try { main() } catch (error) {
  console.error(error.stack)
  process.exitCode = 1
}
