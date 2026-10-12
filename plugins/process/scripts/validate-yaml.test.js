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
const { spawnSync } = require('node:child_process')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { test } = require('node:test')

const PACKAGE_DIR = resolve(__dirname, '..')
const CLI = join(__dirname, 'validate-yaml.js')

function run (args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: PACKAGE_DIR, encoding: 'utf8' })
}

test('validates the single YAML format in both packaging modes in one invocation', () => {
  const result = run([
    'docs/examples/risk-management.card.yaml',
    'docs/examples/review-task.process.yaml',
    'docs/examples/approval.process.yaml',
    'docs/examples/estimate-review.process.yaml'
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(result.stdout.match(/valid YAML definition \(offline\)/g)?.length, 4)
})

test('reports semantic errors with source locations and continues checking subsequent files', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'tracex-process-yaml-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = join(directory, 'missing-state.yaml')
  const source = readFileSync(join(PACKAGE_DIR, 'docs/examples/estimate-review.process.yaml'), 'utf8')
  writeFileSync(file, source.replace('to: waiting_for_estimate', 'to: missing_state'))
  const result = run([file, 'docs/examples/approval.process.yaml'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /missing-state\.yaml:\d+:\d+:/)
  assert.match(result.stderr, /processes\.estimate_review\.start\.request_estimate\.to/)
  assert.match(result.stdout, /approval\.process\.yaml: valid/)
})

test('rejects malformed YAML', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'tracex-process-yaml-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = join(directory, 'broken.yaml')
  writeFileSync(file, 'version: 2\nkind: process\nprocesses: [\n')
  const result = run([file])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /broken\.yaml:\d+:\d+:/)
})

test('reports unreadable files', () => {
  const result = run(['docs/examples/does-not-exist.yaml'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /does-not-exist\.yaml/)
  assert.match(result.stderr, /ENOENT/)
})

test('documents usage and rejects missing arguments or unsupported options', () => {
  for (const args of [[], ['--unknown']]) {
    const result = run(args)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /Usage:/)
  }
  const help = run(['--help'])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Usage:/)
  assert.equal(help.stderr, '')
})
