// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const { cpSync, mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { execFileSync } = require('node:child_process')

const root = resolve(__dirname, '../../../..')
const project = resolve(__dirname, '..')
execFileSync(process.execPath, [resolve(root, 'common/scripts/esbuild.js'), ...process.argv.slice(2)], { cwd: project, stdio: 'inherit' })
const destination = resolve(project, 'bundle/authoring')
mkdirSync(destination, { recursive: true })
for (const file of ['authoring.md', 'authoring-v2.schema.json', 'examples']) {
  cpSync(resolve(root, 'plugins/process/docs', file), resolve(destination, file), { recursive: true })
}
