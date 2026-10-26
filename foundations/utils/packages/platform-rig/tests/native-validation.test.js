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
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const { prepareNativeConfig, validateNative, NativeValidationError } = require('../bin/native-validation')

function fixture(t, source = 'export const value = 1') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-native-validation-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.mkdirSync(path.join(directory, 'src'))
  fs.writeFileSync(path.join(directory, 'src/index.ts'), source)
  fs.writeFileSync(path.join(directory, 'base.json'), JSON.stringify({
    compilerOptions: {
      target: 'es2021', module: 'esnext', moduleResolution: 'node', strict: true,
      declaration: true, declarationMap: true, rootDir: './src', declarationDir: './types'
    }
  }))
  fs.writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({
    extends: './base.json', include: ['src/**/*.ts']
  }))
  return directory
}

test('native configuration preserves the original project and generated Svelte declarations', (t) => {
  const directory = fixture(t)
  fs.mkdirSync(path.join(directory, 'types'))
  const svelte = path.join(directory, 'types/View.svelte.d.ts')
  fs.writeFileSync(svelte, 'export default class View {}')
  const filename = prepareNativeConfig(directory, path.join(directory, '.validate'))
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'))
  assert.equal(config.extends, path.join(directory, 'tsconfig.json'))
  assert.equal(config.compilerOptions.strict, true)
  assert.equal(config.compilerOptions.moduleResolution, 'bundler')
  assert.equal(config.compilerOptions.emitDeclarationOnly, true)
  assert.equal(config.compilerOptions.noEmit, false)
  assert.equal(config.compilerOptions.tsBuildInfoFile, path.join(directory, '.validate/native.tsbuildinfo'))
  assert.deepEqual(config.compilerOptions.typeRoots, [path.join(directory, 'node_modules/@types'), path.join(directory, 'types')])
  assert.deepEqual(config.files, [svelte])
  assert.deepEqual(config.include, [path.join(directory, 'src/**/*.ts')])
  assert(config.exclude.includes(path.join(directory, 'types')))
})

test('implicit include stays relative to the original project when emitting into an isolated directory', (t) => {
  const directory = fixture(t)
  fs.writeFileSync(path.join(directory, 'tsconfig.json'), '{ "extends": "./base.json" }')
  const filename = prepareNativeConfig(directory, path.join(directory, '.validate'), {
    declarationDir: path.join(directory, 'isolated-types')
  })
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'))
  assert.deepEqual(config.include, [path.join(directory, '**/*')])
  assert(config.exclude.includes(path.join(directory, 'types')))
})

test('ambiguous declaration layouts and circular configs are rejected', (t) => {
  const directory = fixture(t)
  fs.writeFileSync(path.join(directory, 'base.json'), '{ "compilerOptions": {} }')
  assert.throws(() => prepareNativeConfig(directory, path.join(directory, '.validate')), /explicit rootDir/)
  fs.writeFileSync(path.join(directory, 'base.json'), '{ "extends": "./tsconfig.json" }')
  assert.throws(() => prepareNativeConfig(directory, path.join(directory, '.validate')), /Circular tsconfig/)
})

test('native validation reports type errors without falling back to another compiler', async (t) => {
  const directory = fixture(t, 'export const value: string = 123')
  await assert.rejects(validateNative(directory), error => error instanceof NativeValidationError && /TS2322/.test(error.message))
  assert.match(fs.readFileSync(path.join(directory, '.validate/validate.log'), 'utf8'), /TS2322/)
})

test('native declarations retain their output paths and TypeScript 5.9 syntax compatibility', async (t) => {
  const directory = fixture(t, 'export interface Value { name: string }; export const value: Value = { name: "test" }')
  await validateNative(directory)
  const declarationPath = path.join(directory, 'types/index.d.ts')
  const declaration = ts.createSourceFile(declarationPath, fs.readFileSync(declarationPath, 'utf8'), ts.ScriptTarget.Latest, true)
  assert.equal(declaration.parseDiagnostics.length, 0)
  assert(fs.existsSync(path.join(directory, 'types/index.d.ts.map')))
  assert(!fs.existsSync(path.join(directory, 'types/index.js')))
  assert.equal(ts.version, '5.9.3')
})

async function dispatch(packageName, failNative = false) {
  const calls = []
  const fakeFs = {
    existsSync: filename => filename === '/fixture/package.json',
    readFileSync: () => JSON.stringify({ name: packageName }),
    mkdirSync() {},
    writeFileSync() {}
  }
  const fakeProcess = { argv: ['node', '/tools/compile.js', 'validate'], cwd: () => '/fixture', exitCode: 0 }
  const modules = {
    path,
    fs: fakeFs,
    child_process: {},
    '../native-validation.json': { packages: ['@test/native'] },
    './native-validation': {
      async validateNative() {
        calls.push('native')
        if (failNative) throw new Error('Native failure')
      }
    },
    typescript: {
      sys: {},
      findConfigFile: () => '/fixture/tsconfig.json',
      readConfigFile: () => ({ config: { compilerOptions: {} } }),
      parseJsonConfigFileContent: () => ({ options: {}, fileNames: [] }),
      createProgram() {
        calls.push('legacy')
        return { emit: () => ({ diagnostics: [], emitSkipped: false }) }
      },
      getPreEmitDiagnostics: () => []
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../bin/compile.js'), 'utf8'), {
    require(name) {
      assert(name in modules, `Unexpected import: ${name}`)
      return modules[name]
    },
    process: fakeProcess,
    performance: { now: () => 0 },
    console: { log() {}, error() {} }
  })
  await new Promise(resolve => setImmediate(resolve))
  return { calls, exitCode: fakeProcess.exitCode }
}

test('compiler dispatch uses only the approved compiler and never retries failures on legacy', async () => {
  assert.deepEqual(await dispatch('@test/native'), { calls: ['native'], exitCode: 0 })
  assert.deepEqual(await dispatch('@test/legacy'), { calls: ['legacy'], exitCode: 0 })
  assert.deepEqual(await dispatch('@test/native', true), { calls: ['native'], exitCode: 1 })
})
