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

const { readFileSync } = require('node:fs')

const USAGE = [
  'Usage:',
  '  rushx package:plan release <publisher/package> <version> <definition.yaml>',
  '  rushx package:plan compare <installed.json> <incoming.json> [local.yaml]',
  'Prints JSON to stdout. Never imports, applies upgrades or runs a build.',
  'Exit codes: 0 = release/compatible candidate/no change; 1 = review or conflict; 2 = invalid input/setup.'
].join('\n')

/** Creates release envelopes or previews upgrades without any workspace writes. */
async function main (args, services = {}) {
  const output = services.output ?? console.info
  const errorOutput = services.error ?? console.error
  const readFile = services.readFile ?? ((path) => readFileSync(path, 'utf8'))
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    output(USAGE)
    return 0
  }
  if (!((args[0] === 'release' && args.length === 4) ||
    (args[0] === 'compare' && [3, 4].includes(args.length)))) {
    errorOutput(USAGE)
    return 2
  }
  let engine
  try {
    engine = services.engine ?? {
      ...require('../lib/definition-package'),
      ...require('../lib/definition-package-plan')
    }
  } catch (error) {
    errorOutput(`Cannot load package analysis: ${error instanceof Error ? error.message : String(error)}`)
    errorOutput('Install repository dependencies and refresh compiler artifacts through the normal development build.')
    return 2
  }
  try {
    if (args[0] === 'release') {
      const release = await engine.createDefinitionPackageRelease({
        package: { id: args[1], version: args[2] }, source: readFile(args[3])
      })
      output(JSON.stringify({ package: release.package, source: release.source, contentHash: release.contentHash }, null, 2))
      return 0
    }
    const installed = await engine.parseDefinitionPackageRelease(readFile(args[1]))
    const incoming = await engine.parseDefinitionPackageRelease(readFile(args[2]))
    const plan = await engine.planDefinitionPackageUpgrade(installed, incoming, args[3] === undefined ? undefined : readFile(args[3]))
    output(JSON.stringify(plan, null, 2))
    return ['conflict', 'review-required'].includes(plan.status) ? 1 : 0
  } catch (error) {
    errorOutput(error instanceof Error ? error.message : String(error))
    return 2
  }
}

module.exports = { main }
if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  })
}
