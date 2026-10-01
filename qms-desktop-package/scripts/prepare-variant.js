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
const path = require('node:path')

const variant = process.argv[2]
if (variant !== 'prod' && variant !== 'staging') {
  throw new Error('Expected desktop variant: prod or staging')
}

const source = path.join(__dirname, '..', 'src', variant === 'prod' ? '' : 'staging')
const destination = path.join(__dirname, '..', 'dist', 'ui', 'public')
const mainEntry = path.join(__dirname, '..', 'dist', 'main', 'electron.js')

if (!fs.existsSync(mainEntry) || !fs.existsSync(destination)) {
  throw new Error(
    'Desktop package is missing. From the repository root, run ' +
    '`node common/scripts/install-run-rush.js package --to qms-desktop -v` before dist.'
  )
}

for (const extension of ['png', 'ico']) {
  fs.copyFileSync(path.join(source, `AppIcon.${extension}`), path.join(destination, `AppIcon.${extension}`))
}
