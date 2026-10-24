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

const { readFileSync } = require('node:fs')

const USAGE = 'Usage: node plugins/process/scripts/validate-yaml.js <file.yaml> [more files...]'

/** Validates authoring files with the existing compiler without importing or writing documents. */
function main (files) {
  if (files.length === 1 && (files[0] === '--help' || files[0] === '-h')) {
    console.info(USAGE)
    return 0
  }
  if (files.length === 0 || files.some((file) => file.startsWith('-'))) {
    console.error(USAGE)
    return 2
  }

  let validateProcessYaml
  try {
    validateProcessYaml = require('../lib/authoring').validateProcessYaml
  } catch (error) {
    console.error(`Cannot load the YAML authoring compiler: ${error instanceof Error ? error.message : String(error)}`)
    console.error('Install repository dependencies with rush install and ensure the compiler has been built during normal development.')
    return 2
  }

  let exitCode = 0
  for (const file of files) {
    try {
      const result = validateProcessYaml(readFileSync(file, 'utf8'))
      if (result.valid) {
        console.info(`${file}: valid YAML definition (offline)`)
      } else {
        const diagnostic = result.diagnostic
        const location = diagnostic?.line === undefined ? file : `${file}:${diagnostic.line}:${diagnostic.column ?? 1}`
        console.error(`${location}: ${diagnostic?.message ?? 'Invalid YAML definition'}`)
        exitCode = 1
      }
    } catch (error) {
      console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`)
      exitCode = 1
    }
  }
  return exitCode
}

process.exitCode = main(process.argv.slice(2))
