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

// Renders sample notification emails into ./email-preview for manual review.
// Images are copied next to the HTML, so the preview works offline.
// Usage: rushx build && rushx email-preview
const fs = require('fs')
const path = require('path')
const { assets, buildEmailLayout, emailDataFixtures, emailFixtures, fixtureFrontUrl, renderEmail } = require('../lib/email')

const out = path.join(__dirname, '..', 'email-preview')
const publicDir = path.join(__dirname, '..', '..', '..', 'dev', 'prod', 'public')

fs.mkdirSync(out, { recursive: true })
for (const asset of Object.values(assets)) {
  const target = path.join(out, asset.path)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(path.join(publicDir, asset.path), target)
}

// Hand-made layouts (design reference) and layouts built from notification data.
const kinds = [
  ...Object.entries(emailFixtures()),
  ...Object.entries(emailDataFixtures()).map(([kind, data]) => [kind, buildEmailLayout(data)])
]
for (const [kind, layout] of kinds) {
  let html = renderEmail(layout)
  for (const asset of Object.values(assets)) {
    html = html.split(fixtureFrontUrl + asset.path).join('.' + asset.path)
  }
  fs.writeFileSync(path.join(out, `${kind}.html`), html)
}
const index = kinds.map(([kind]) => `<li><a href="${kind}.html">${kind}</a></li>`).join('')
fs.writeFileSync(path.join(out, 'index.html'), `<!DOCTYPE html><meta charset="utf-8"><ul>${index}</ul>`)
console.log(`Rendered ${kinds.length} emails to ${out}`)
