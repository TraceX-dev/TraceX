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

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const OUTPUT_FOLDERS = ['lib', 'types', 'bundle', '.build', '.validate']
const TOOL_BUNDLE = 'dev/tool/bundle/bundle.js'
const MANIFEST = '.ci-build-manifest.json'

class BuildArtifactError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BuildArtifactError'
  }
}

function outputPaths(projects) {
  return projects.flatMap(project => OUTPUT_FOLDERS.map(folder => `${project.projectFolder}/${folder}`))
}

/** Archive only generated package outputs, preserving symlinks and executable modes. */
function pack(root, projects, revision, filename) {
  if (projects.some(project => project.projectFolder === 'dev/tool') && !fs.existsSync(path.join(root, TOOL_BUNDLE))) {
    throw new BuildArtifactError('Missing administration tool bundle; bundle @hcengineering/tool before archiving outputs')
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-ci-artifacts-'))
  const manifestPath = path.join(root, MANIFEST)
  let manifestWritten = false
  try {
    const paths = outputPaths(projects).filter(relative => fs.existsSync(path.join(root, relative)))
    if (paths.length === 0) throw new BuildArtifactError('No package build outputs were found')
    fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, revision, paths }), { flag: 'wx' })
    manifestWritten = true
    const list = path.join(directory, 'paths.txt')
    fs.writeFileSync(list, [MANIFEST, ...paths].join('\n') + '\n')
    execFileSync('tar', ['-czf', path.resolve(filename), '-C', root, '-T', list])
  } finally {
    if (manifestWritten) fs.unlinkSync(manifestPath)
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

/** Restore outputs only when the artifact belongs to the checked-out commit. */
function restore(root, projects, revision, filename) {
  const archive = path.resolve(filename)
  const manifest = JSON.parse(execFileSync('tar', ['-xzOf', archive, MANIFEST], { encoding: 'utf8' }))
  if (manifest.version !== 1 || manifest.revision !== revision) {
    throw new BuildArtifactError('Build artifact revision does not match the checked-out commit')
  }
  const allowed = new Set(outputPaths(projects))
  if (!Array.isArray(manifest.paths) || manifest.paths.some(relative => !allowed.has(relative))) {
    throw new BuildArtifactError('Build artifact contains unexpected output directories')
  }
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .trim().split('\n')
  for (const entry of entries) {
    if (entry === MANIFEST) continue
    if (path.posix.isAbsolute(entry) || entry.split('/').includes('..') ||
      !manifest.paths.some(relative => entry === relative || entry.startsWith(relative + '/'))) {
      throw new BuildArtifactError(`Unexpected build artifact entry: ${entry}`)
    }
  }
  execFileSync('tar', ['-xzf', archive, '-C', root, '--exclude', MANIFEST])
}

if (require.main === module) {
  try {
    const [command, filename] = process.argv.slice(2)
    if (!['pack', 'restore'].includes(command) || filename === undefined) {
      throw new BuildArtifactError('Usage: node ci-build-artifacts.js pack|restore ARCHIVE')
    }
    const root = path.resolve(__dirname, '../..')
    const JSON5 = require('../../foundations/utils/packages/platform-rig/node_modules/json5')
    const { projects } = JSON5.parse(fs.readFileSync(path.join(root, 'rush.json'), 'utf8'))
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    if (command === 'pack') pack(root, projects, revision, filename)
    else restore(root, projects, revision, filename)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

module.exports = { pack, restore, BuildArtifactError }
