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

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '../..')
const fromText = createRequire(path.join(root, 'foundations/core/packages/text/package.json'))
const fromEditor = createRequire(path.join(root, 'plugins/text-editor-resources/package.json'))
const ts = fromText('typescript')
// Use application dependencies and sources; no install, build or paid SDK is needed.
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

const { Awareness, getEditorContext } = fromText('../text-agent/src/index.ts')
const { EditorState } = fromText('@tiptap/pm/state')
const { ServerKit } = fromText('./src/kits/server-kit.ts')
const agent = fromText('../text-agent/src/operations/index.ts')
const Y = fromEditor('yjs')
const binding = fromEditor('@tiptap/y-tiptap')
const awareness = new Awareness([ServerKit])
const schema = awareness.schema
const scope = {
  document: 'probe-workspace|class|document|content', field: 'content',
  hash: (value) => createHash('sha256').update(value).digest('hex')
}
const policy = {
  nodes: {
    paragraph: { insertable: true, deletable: true, textEditable: true },
    heading: { editableAttrs: ['level'], insertable: true, deletable: true, textEditable: true },
    blockquote: { insertable: true, deletable: true, textEditable: true }
  },
  marks: { bold: { editable: true }, italic: { editable: true }, link: { editable: true } }
}
const cases = []
let assertions = 0

function verify (condition, message) {
  assert.ok(condition, message)
  assertions++
}

function fixture () {
  return {
    type: 'doc', content: [
      { type: 'paragraph', content: [
        { type: 'text', text: 'hel', marks: [{ type: 'bold' }, { type: 'node-uuid', attrs: { 'node-uuid': 'thread' } }] },
        { type: 'text', text: 'lo world', marks: [{ type: 'node-uuid', attrs: { 'node-uuid': 'thread' } }] }
      ] },
      { type: 'paragraph', content: [{ type: 'text', text: 'untouched' }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'cell' }] }
      ] }] }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'before' },
        { type: 'reference', attrs: { id: 'external', objectclass: 'class', label: 'Object' } },
        { type: 'image', attrs: { src: 'image.png' } },
        { type: 'text', text: 'after' }
      ] }
    ]
  }
}

function create (raw = fixture(), gc = false) {
  const doc = new Y.Doc({ gc })
  binding.prosemirrorToYXmlFragment(agent.parseAgentNode(awareness, raw), doc.getXmlFragment('content'))
  return doc
}

function clone (doc) {
  const peer = new Y.Doc({ gc: doc.gc })
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
  return peer
}

function read (doc) {
  const fragment = doc.getXmlFragment('content')
  // Reject unsupported raw content before calling converters that may normalize it.
  agent.parseAgentNode(awareness, binding.yXmlFragmentToProsemirrorJSON(fragment))
  const before = Y.encodeStateVector(doc)
  const initial = binding.initProseMirrorDoc(fragment, schema)
  const state = EditorState.create({ schema, doc: initial.doc })
  const references = agent.createYjsReferences(doc, initial.mapping, scope)
  const index = agent.indexAgentDocument(state.doc, scope, references)
  assert.deepEqual(Y.encodeStateVector(doc), before, 'Reading must not create Yjs structs')
  return { fragment, initial, state, index, references }
}

function ref (snapshot, nodePath = '0') {
  const entry = snapshot.index.entries.find((entry) => entry.path.join('/') === nodePath)
  assert.ok(entry, `Missing node ${nodePath}`)
  return entry.ref
}

function apply (doc, operations) {
  const snapshot = read(doc)
  const result = agent.prepareAgentOperations(awareness, snapshot.state, operations(snapshot), scope, policy, snapshot.references)
  if (!result.ok) return result
  if (result.transaction.docChanged) {
    doc.transact(() => {
      binding.updateYFragment(doc, snapshot.fragment, result.transaction.doc, snapshot.initial.meta)
    }, 'agent-ops-probe')
  }
  const committed = read(doc)
  verify(committed.state.doc.eq(result.transaction.doc), 'Live Yjs result equals the staged ProseMirror result')
  return { ...result, results: agent.finalizeAgentOperations(result, committed.index) }
}

function scenario (name, run) {
  run()
  cases.push({ name, status: 'passed' })
}

scenario('read_is_side_effect_free', () => {
  const doc = create()
  const before = Y.encodeStateAsUpdate(doc)
  let updates = 0
  doc.on('update', () => { updates++ })
  const snapshot = read(doc)
  getEditorContext(awareness)
  const target = agent.resolveAgentTarget(snapshot.index, ref(snapshot))
  verify(snapshot.state.doc.nodeAt(target.from) !== null, 'The live handle resolves to a node')
  verify(updates === 0, 'No update events during supported reads')
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before)
  verify(snapshot.state.doc.firstChild.attrs.uid == null, 'Legacy nodes remain without generated uid')
  doc.destroy()
})

scenario('batch_preserves_other_ytypes_and_atoms', () => {
  const doc = create()
  const original = doc.getXmlFragment('content').toArray()
  const result = apply(doc, (snapshot) => {
    const target = ref(snapshot)
    return [
      { op: 'replace_text', ref: target, search: 'hello', replace: 'agent' },
      { op: 'add_mark', ref: target, search: 'agent', mark: { type: 'italic' } },
      { op: 'insert_node', at: { ref: target, where: 'before' }, node: { type: 'paragraph' } },
      { op: 'replace_text', ref: ref(snapshot, '3/0/0/0'), search: 'cell', replace: 'edited cell' }
    ]
  })
  verify(result.ok, 'The complete mixed batch succeeds')
  const current = doc.getXmlFragment('content').toArray()
  verify(current[2] === original[1], 'Untouched paragraph retains its live Yjs identity')
  verify(current[3] === original[2], 'Untouched nested subtree retains its live Yjs identity')
  verify(current[5] === original[4], 'Paragraph containing references and images retains its live Yjs identity')
  const target = read(doc).state.doc.child(1)
  verify(target.firstChild.marks.some((mark) => mark.type.name === 'node-uuid'), 'Existing comment anchor survives replacement')
  verify(target.attrs.uid == null, 'Insertion and editing do not backfill uid')
  doc.destroy()
})

scenario('invalid_batch_does_not_write', () => {
  const doc = create()
  const before = Y.encodeStateAsUpdate(doc)
  let updates = 0
  doc.on('update', () => { updates++ })
  const result = apply(doc, (snapshot) => [
    { op: 'replace_text', ref: ref(snapshot), search: 'hello', replace: 'changed' },
    { op: 'replace_text', ref: ref(snapshot), search: 'absent', replace: 'x' }
  ])
  verify(!result.ok && result.opIndex === 1, 'Late validation failure rejects the whole batch')
  verify(updates === 0, 'Failed preparation does not produce any updates')
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before)
  doc.destroy()
})

scenario('container_handle_survives_remote_text_edit', () => {
  const doc = create()
  const old = ref(read(doc))
  const peer = clone(doc)
  assert.ok(apply(peer, (snapshot) => [{ op: 'replace_text', ref: ref(snapshot), search: 'hello', replace: 'human' }]).ok)
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer))
  const result = apply(doc, () => [{ op: 'replace_text', ref: old, search: 'human', replace: 'agent' }])
  verify(result.ok && result.results[0].ref === old, 'Live container handle survives a remote text edit')
  doc.destroy()
  peer.destroy()
})

scenario('container_handle_survives_text_edit_and_reload', () => {
  const doc = create()
  const old = ref(read(doc))
  assert.ok(apply(doc, () => [{ op: 'replace_text', ref: old, search: 'hello', replace: 'human' }]).ok)
  const peer = clone(doc)
  const result = apply(peer, () => [{ op: 'replace_text', ref: old, search: 'human', replace: 'agent' }])
  verify(result.ok && result.results[0].ref === old, 'Container handle survives edits and binary reload without stored uid')
  doc.destroy()
  peer.destroy()
})

scenario('attribute_update_preserves_container_handle', () => {
  const raw = fixture()
  raw.content[0].type = 'heading'
  raw.content[0].attrs = { level: 1 }
  const doc = create(raw)
  const before = ref(read(doc))
  const result = apply(doc, () => [{ op: 'update_attrs', ref: before, attrs: { level: 2 } }])
  verify(result.ok && result.results[0].ref === before, 'Updating attributes preserves the live container handle')
  verify(read(doc).state.doc.firstChild.attrs.level === 2, 'Attribute update is present in the live document')
  doc.destroy()
})

scenario('new_handles_are_issued_after_live_insertion', () => {
  const doc = create()
  const result = apply(doc, () => [{
    op: 'insert_node', at: { ref: 'root', where: 'start' },
    node: { type: 'paragraph', content: [{ type: 'text', text: 'new' }] }
  }])
  verify(result.ok && result.results[0].ref === ref(read(doc)), 'Inserted node receives its actual Yjs handle after reconciliation')
  const next = apply(doc, () => [{ op: 'replace_text', ref: result.results[0].ref, search: 'new', replace: 'edited' }])
  verify(next.ok && read(doc).state.doc.firstChild.textContent === 'edited', 'Returned insertion handle works on the next request')
  doc.destroy()
})

scenario('deletion_guard_rejects_remote_marks_without_losing_the_edit', () => {
  const doc = create()
  const before = read(doc)
  const target = before.index.entries[1]
  const peer = clone(doc)
  assert.ok(apply(peer, () => [{ op: 'add_mark', ref: target.ref, search: 'untouched', mark: { type: 'bold' } }]).ok)
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer))
  const unchanged = Y.encodeStateAsUpdate(doc)
  const result = apply(doc, () => [{ op: 'delete_node', ref: target.ref, expectedFingerprint: target.fingerprint }])
  verify(!result.ok && result.error.code === 'STALE_REFERENCE', 'A mark-only remote change invalidates the deletion precondition')
  assert.deepEqual(Y.encodeStateAsUpdate(doc), unchanged)
  verify(read(doc).state.doc.child(1).firstChild.marks.some((mark) => mark.type.name === 'bold'), 'Rejected deletion preserves the human change')
  doc.destroy()
  peer.destroy()
})

scenario('deletion_guard_uses_initial_batch_state', () => {
  const doc = create()
  const result = apply(doc, (snapshot) => {
    const target = snapshot.index.entries.find((entry) => entry.path.join('/') === '1')
    return [
      { op: 'replace_text', ref: target.ref, search: 'untouched', replace: 'changed' },
      { op: 'delete_node', ref: target.ref, expectedFingerprint: target.fingerprint }
    ]
  })
  verify(result.ok && result.results.every((entry) => entry.deleted === true), 'Own preceding edit does not invalidate deletion within a batch')
  verify(read(doc).state.doc.childCount === 4, 'The intended subtree was deleted')
  doc.destroy()
})

scenario('deleted_handle_cannot_target_an_identical_replacement', () => {
  const doc = create()
  const before = read(doc)
  const entry = before.index.entries.find((entry) => entry.path.join('/') === '1')
  const handle = entry.ref
  const saved = before.state.doc.child(1).toJSON()
  assert.ok(apply(doc, () => [{ op: 'delete_node', ref: handle, expectedFingerprint: entry.fingerprint }]).ok)
  assert.ok(apply(doc, () => [{ op: 'insert_node', at: { ref: ref(before), where: 'after' }, node: saved }]).ok)
  const result = apply(doc, () => [{ op: 'replace_text', ref: handle, search: 'untouched', replace: 'wrong' }])
  verify(!result.ok && result.error.code === 'STALE_REFERENCE', 'A removed container handle cannot address a replacement at the same path')
  doc.destroy()
})

scenario('json_rebuild_invalidates_handles', () => {
  const doc = create()
  const handle = ref(read(doc))
  const rebuilt = create(read(doc).state.doc.toJSON())
  const result = apply(rebuilt, () => [{ op: 'replace_text', ref: handle, search: 'hello', replace: 'wrong' }])
  verify(!result.ok && result.error.code === 'STALE_REFERENCE', 'Rebuilding the document from JSON invalidates old handles')
  doc.destroy()
  rebuilt.destroy()
})

scenario('unsupported_raw_schema_is_not_normalized', () => {
  const doc = create()
  const fragment = doc.getXmlFragment('content')
  fragment.get(0).setAttribute('futureAttribute', 'preserve')
  const before = Y.encodeStateAsUpdate(doc)
  let updates = 0
  doc.on('update', () => { updates++ })
  assert.throws(() => read(doc), /unknown attribute/)
  verify(updates === 0, 'Unknown data is rejected before mutating conversion')
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before)
  doc.destroy()
})

scenario('concurrent_edits_in_different_blocks', () => {
  const doc = create()
  const peer = clone(doc)
  assert.ok(apply(doc, (snapshot) => [{ op: 'replace_text', ref: ref(snapshot), search: 'hello', replace: 'agent' }]).ok)
  assert.ok(apply(peer, (snapshot) => [{ op: 'replace_text', ref: ref(snapshot, '1'), search: 'untouched', replace: 'human' }]).ok)
  const agentUpdate = Y.encodeStateAsUpdate(doc)
  const humanUpdate = Y.encodeStateAsUpdate(peer)
  Y.applyUpdate(doc, humanUpdate)
  Y.applyUpdate(peer, agentUpdate)
  verify(read(doc).state.doc.eq(read(peer).state.doc), 'Replicas converge after concurrent edits in different blocks')
  verify(read(doc).state.doc.textContent.includes('agent') && read(doc).state.doc.textContent.includes('human'), 'Both independent edits remain')
  doc.destroy()
  peer.destroy()
})

scenario('concurrent_edits_in_the_same_block', () => {
  const doc = create()
  const peer = clone(doc)
  assert.ok(apply(doc, (snapshot) => [{ op: 'replace_text', ref: ref(snapshot), search: 'hello', replace: 'agent' }]).ok)
  assert.ok(apply(peer, (snapshot) => [{ op: 'replace_text', ref: ref(snapshot), search: 'world', replace: 'human' }]).ok)
  const agentUpdate = Y.encodeStateAsUpdate(doc)
  const humanUpdate = Y.encodeStateAsUpdate(peer)
  Y.applyUpdate(doc, humanUpdate)
  Y.applyUpdate(peer, agentUpdate)
  verify(read(doc).state.doc.eq(read(peer).state.doc), 'Replicas converge after independent text edits in the same block')
  verify(read(doc).state.doc.firstChild.textContent === 'agent human', 'Both non-overlapping text edits remain')
  doc.destroy()
  peer.destroy()
})

process.stdout.write(`${JSON.stringify({
  scope: 'Real ServerKit, pure operation compiler and two in-memory Yjs replicas; no HTTP, Hocuspocus persistence, MCP transport or browser.',
  assertions, cases
}, null, 2)}\n`)
