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

const { execFileSync } = require('node:child_process')
const path = require('node:path')

/** Export all images built for this commit, including the aliases used by Compose. */
function saveImages(filename, revision) {
  const output = execFileSync('docker', [
    'image', 'ls', '--format', '{{.Repository}}\t{{.Tag}}'
  ], { encoding: 'utf8' })
  // Docker reference globs do not cross '/' in namespaced repository names.
  const repositories = [...new Set(output.trim().split('\n')
    .map(line => line.split('\t'))
    .filter(([repository, tag]) => repository !== '<none>' && tag === revision)
    .map(([repository]) => repository))]
  if (repositories.length === 0) throw new Error(`No Docker images were built for ${revision}`)
  const tags = []
  for (const repository of repositories) {
    const commitTag = `${repository}:${revision}`
    const latestTag = `${repository}:latest`
    const inspect = tag => execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', tag], { encoding: 'utf8' }).trim()
    if (inspect(commitTag) !== inspect(latestTag)) throw new Error(`Image aliases do not match: ${repository}`)
    tags.push(commitTag, latestTag)
  }
  execFileSync('docker', ['image', 'save', '--output', path.resolve(filename), ...tags], { stdio: 'inherit' })
}

if (require.main === module) {
  try {
    const [command, filename, revision] = process.argv.slice(2)
    if (command !== 'save' || filename === undefined || revision === undefined) {
      throw new Error('Usage: node ci-docker-images.js save ARCHIVE COMMIT')
    }
    saveImages(filename, revision)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

module.exports = { saveImages }
