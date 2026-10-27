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
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const { pack, restore } = require('./ci-build-artifacts')
const { saveImages } = require('./ci-docker-images')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-ci-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function dockerFixture(t, scenario = 'success') {
  const root = fixture(t)
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.CI_DOCKER_LOG, JSON.stringify(args) + '\\n')
const scenario = process.env.CI_DOCKER_SCENARIO
if (args[0] === 'build' && scenario === 'build-failure') process.exit(37)
if (args[0] === 'tag' && scenario === 'tag-failure') process.exit(37)
if (args[0] === 'push' && scenario === 'push-failure') process.exit(37)
if (args[0] === 'image' && args[1] === 'ls') {
  // Docker reference globs use path.Match: '*' does not cross repository slashes.
  if (!args.includes('--filter') && scenario !== 'empty') {
    console.log('tracexapp/front\\tabc123\\ntracexapp/server\\tabc123\\ntracexapp/front\\tabc123')
    console.log('registry.example:5000/team/service\\tabc123')
    console.log('tracexapp/old\\told-sha\\ntracexapp/partial\\tabc123-extra\\n<none>\\t<none>')
  }
}
if (args[0] === 'image' && args[1] === 'inspect') {
  const tag = args.at(-1)
  console.log(scenario === 'stale-alias' && tag.endsWith(':latest') ? 'stale' : tag.split(':')[0])
}
if (args[0] === 'image' && args[1] === 'save') {
  if (scenario === 'save-failure') process.exit(37)
  fs.writeFileSync(args[3], JSON.stringify(args.slice(4)))
}
`, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\necho abc123\n', { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const log = path.join(root, 'docker.log')
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    CI_DOCKER_LOG: log,
    CI_DOCKER_SCENARIO: scenario,
    DOCKER_VERSION: 'abc123'
  }
  return { root, env, calls: () => fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) }
}

function shell(script, fixture, env = {}) {
  return spawnSync('bash', [path.join(__dirname, script), 'tracexapp/test'], {
    cwd: fixture.root, env: { ...fixture.env, ...env }, encoding: 'utf8'
  })
}

function withEnvironment(env, callback) {
  const previous = process.env
  process.env = { ...env }
  try {
    return callback()
  } finally {
    process.env = previous
  }
}

test('Docker failure reaches Rush and preserves outputs, with cleanup enabled or disabled', t => {
  for (const cleanup of ['true', 'false']) {
    const f = dockerFixture(t, 'build-failure')
    for (const directory of ['bundle', 'dist', '.rush']) fs.mkdirSync(path.join(f.root, directory))
    const result = shell('docker_build.sh', f, { DOCKER_BUILD_CLEANUP: cleanup })
    assert.equal(result.status, 37, result.stderr)
    for (const directory of ['bundle', 'dist', '.rush']) assert(fs.existsSync(path.join(f.root, directory)))
  }
})

test('successful Docker builds retain requested tags and platform, and clean only when requested', t => {
  for (const cleanup of ['true', 'false']) {
    const f = dockerFixture(t)
    for (const directory of ['bundle', 'dist', '.rush']) fs.mkdirSync(path.join(f.root, directory))
    const result = shell('docker_build.sh', f, {
      DOCKER_BUILD_CLEANUP: cleanup, DOCKER_EXTRA: '--platform=linux/amd64 --pull'
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(f.calls()[0], [
      'build', '-t', 'tracexapp/test', '-t', 'tracexapp/test:abc123', '--platform=linux/amd64', '--pull', '.'
    ])
    for (const directory of ['bundle', 'dist', '.rush']) {
      assert.equal(fs.existsSync(path.join(f.root, directory)), cleanup === 'false')
    }
  }
})

test('Docker builds also work without optional environment variables', t => {
  const f = dockerFixture(t)
  const env = { ...f.env }
  delete env.DOCKER_EXTRA
  delete env.DOCKER_BUILD_CLEANUP
  const result = shell('docker_build.sh', { ...f, env })
  assert.equal(result.status, 0, result.stderr)
})

test('a failed Docker tag never pushes an older release image', t => {
  const f = dockerFixture(t, 'tag-failure')
  const result = shell('docker_tag.sh', f)
  assert.equal(result.status, 37, result.stderr)
  assert.deepEqual(f.calls().map(args => args[0]), ['tag'])
})

test('exhausted Docker push retries fail the release job', t => {
  const f = dockerFixture(t, 'push-failure')
  const result = shell('docker_tag.sh', f)
  assert.equal(result.status, 1, result.stderr)
  assert.equal(f.calls().filter(args => args[0] === 'push').length, 25)
})

test('staging tagging increments a zero patch version without failing arithmetic', t => {
  const f = dockerFixture(t)
  const result = spawnSync('bash', [path.join(__dirname, 'docker_tag.sh'), 'tracexapp/test', 'staging'], {
    cwd: f.root, env: { ...f.env, DOCKER_VERSION: 'v1.2.0' }, encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(f.calls()[0], ['tag', 'tracexapp/test:abc123', 'tracexapp/test:v1.2.1-staging'])
})

test('package artifacts preserve modes and symlinks while excluding source and dependencies', t => {
  const root = fixture(t)
  const source = path.join(root, 'source')
  const destination = path.join(root, 'destination')
  fs.mkdirSync(path.join(source, 'project/lib'), { recursive: true })
  fs.mkdirSync(path.join(source, 'project/src'))
  fs.mkdirSync(path.join(source, 'project/node_modules'))
  fs.mkdirSync(destination)
  fs.writeFileSync(path.join(source, 'project/lib/tool.js'), 'compiled', { mode: 0o755 })
  fs.symlinkSync('tool.js', path.join(source, 'project/lib/alias.js'))
  fs.writeFileSync(path.join(source, 'project/src/index.ts'), 'source')
  fs.writeFileSync(path.join(source, 'project/node_modules/token'), 'not an artifact')
  const projects = [{ projectFolder: 'project' }]
  const archive = path.join(root, 'outputs.tgz')
  pack(source, projects, 'abc123', archive)
  restore(destination, projects, 'abc123', archive)
  assert.equal(fs.readFileSync(path.join(destination, 'project/lib/tool.js'), 'utf8'), 'compiled')
  assert.equal(fs.statSync(path.join(destination, 'project/lib/tool.js')).mode & 0o777, 0o755)
  assert.equal(fs.readlinkSync(path.join(destination, 'project/lib/alias.js')), 'tool.js')
  assert(!fs.existsSync(path.join(destination, 'project/src')))
  assert(!fs.existsSync(path.join(destination, 'project/node_modules')))
})

test('an artifact from another commit is rejected before extraction', t => {
  const root = fixture(t)
  fs.mkdirSync(path.join(root, 'project/types'), { recursive: true })
  fs.writeFileSync(path.join(root, 'project/types/index.d.ts'), 'export {}')
  const archive = path.join(root, 'outputs.tgz')
  const projects = [{ projectFolder: 'project' }]
  pack(root, projects, 'abc123', archive)
  fs.rmSync(path.join(root, 'project/types'), { recursive: true })
  assert.throws(() => restore(root, projects, 'different', archive), /revision does not match/)
  assert(!fs.existsSync(path.join(root, 'project/types')))
})

test('the real profiling wrapper can launch the tool after restoring artifacts on a clean runner', t => {
  const root = fixture(t)
  const source = path.join(root, 'source')
  const destination = path.join(root, 'destination')
  fs.mkdirSync(path.join(source, 'dev/tool/lib'), { recursive: true })
  fs.mkdirSync(path.join(source, 'dev/tool/bundle'))
  fs.writeFileSync(path.join(source, 'dev/tool/lib/index.js'), 'exports.compiled = true')
  fs.writeFileSync(path.join(source, 'dev/tool/bundle/bundle.js'), 'console.log(JSON.stringify(process.argv.slice(2)))')
  fs.mkdirSync(path.join(destination, 'tests'), { recursive: true })
  fs.mkdirSync(path.join(destination, 'common/scripts'), { recursive: true })
  fs.copyFileSync(path.resolve(__dirname, '../../tests/tool.sh'), path.join(destination, 'tests/tool.sh'))
  fs.chmodSync(path.join(destination, 'tests/tool.sh'), 0o755)
  fs.writeFileSync(path.join(destination, 'common/scripts/show_version.js'), 'console.log("0.0.0")')
  const projects = [{ projectFolder: 'dev/tool' }]
  const archive = path.join(root, 'outputs.tgz')
  pack(source, projects, 'abc123', archive)
  restore(destination, projects, 'abc123', archive)
  const result = spawnSync('bash', [path.resolve(__dirname, '../../tests/profile-start.sh')], {
    cwd: path.join(destination, 'tests'), env: { ...process.env, TOOL_OPTIONS: '' }, encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').at(-1)), ['profile', 'http://localhost:3334', 'start'])
})

test('the artifact producer rejects a missing administration tool before uploading outputs', t => {
  const root = fixture(t)
  fs.mkdirSync(path.join(root, 'dev/tool/lib'), { recursive: true })
  fs.writeFileSync(path.join(root, 'dev/tool/lib/index.js'), 'exports.compiled = true')
  assert.throws(
    () => pack(root, [{ projectFolder: 'dev/tool' }], 'abc123', path.join(root, 'outputs.tgz')),
    /administration tool bundle/
  )
})

test('test-image export deduplicates repositories and preserves commit and Compose tags', t => {
  const f = dockerFixture(t)
  const filename = path.join(f.root, 'images.tar')
  withEnvironment(f.env, () => saveImages(filename, 'abc123'))
  assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), [
    'tracexapp/front:abc123', 'tracexapp/front:latest', 'tracexapp/server:abc123', 'tracexapp/server:latest',
    'registry.example:5000/team/service:abc123', 'registry.example:5000/team/service:latest'
  ])
})

test('missing images or stale aliases fail instead of exporting unrelated images', t => {
  for (const scenario of ['empty', 'stale-alias']) {
    const f = dockerFixture(t, scenario)
    assert.throws(() => withEnvironment(f.env, () => saveImages(path.join(f.root, 'images.tar'), 'abc123')))
    assert(!f.calls().some(args => args[1] === 'save'))
  }
})

test('image export requires an exact commit tag rather than a prefix match', t => {
  const f = dockerFixture(t)
  assert.throws(
    () => withEnvironment(f.env, () => saveImages(path.join(f.root, 'images.tar'), 'abc')),
    /No Docker images were built for abc/
  )
  assert(!f.calls().some(args => args[1] === 'inspect' || args[1] === 'save'))
})

test('Docker export failures reach the artifact producer', t => {
  const f = dockerFixture(t, 'save-failure')
  assert.throws(() => withEnvironment(f.env, () => saveImages(path.join(f.root, 'images.tar'), 'abc123')))
})
