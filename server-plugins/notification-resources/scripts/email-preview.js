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

// Renders the sample notification emails into ./email-preview for manual review.
// Images are copied next to the HTML, so the preview works offline.
// Usage: rushx build && rushx email-preview [lang], e.g. `rushx email-preview ru`
const fs = require('fs')
const path = require('path')
const { assets, buildEmailLayout, getEmailStrings, renderEmail } = require('../lib/email')
// Test fixtures are compiled into lib/__tests__ but are not exported from the package.
const { emailDataFixtures, fixtureFrontUrl } = require('../lib/__tests__/fixtures')

const lang = process.argv[2] ?? 'en'
const out = path.join(__dirname, '..', 'email-preview')
const publicDir = path.join(__dirname, '..', '..', '..', 'dev', 'prod', 'public')

fs.mkdirSync(out, { recursive: true })
for (const asset of Object.values(assets)) {
  const target = path.join(out, asset.path)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(path.join(publicDir, asset.path), target)
}

const kinds = Object.entries(emailDataFixtures()).map(([kind, data]) => [
  `${lang}-${kind}`,
  buildEmailLayout({ ...data, lang }, getEmailStrings(lang))
])
for (const [kind, layout] of kinds) {
  let html = renderEmail(layout)
  for (const asset of Object.values(assets)) {
    html = html.split(fixtureFrontUrl + asset.path).join('.' + asset.path)
  }
  fs.writeFileSync(path.join(out, `${kind}.html`), html)
}
const index = kinds.map(([kind]) => `<li><a href="${kind}.html">${kind}</a></li>`).join('')
fs.writeFileSync(path.join(out, `index-${lang}.html`), `<!DOCTYPE html><meta charset="utf-8"><ul>${index}</ul>`)
console.log(`Rendered ${kinds.length} emails to ${out}`)
