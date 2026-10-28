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

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const JSON5 = require('json5')
const nativeValidation = require('../native-validation.json')

class NativeValidationError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'NativeValidationError'
  }
}

function readConfig(configPath, parents = new Set()) {
  const filename = fs.realpathSync(configPath)
  if (parents.has(filename)) throw new NativeValidationError(`Circular tsconfig extends: ${configPath}`)
  const chain = new Set([...parents, filename])
  const config = JSON5.parse(fs.readFileSync(filename, 'utf8'))
  let compilerOptions = {}
  let files
  let include
  let exclude
  let outputDirectories = {}
  const inherited = Array.isArray(config.extends) ? config.extends : config.extends ? [config.extends] : []
  for (const parent of inherited) {
    const base = parent.startsWith('.') || path.isAbsolute(parent)
      ? path.resolve(path.dirname(configPath), parent)
      : require.resolve(parent, { paths: [path.dirname(configPath)] })
    const resolved = fs.existsSync(base) ? base : `${base}.json`
    const parsed = readConfig(resolved, chain)
    compilerOptions = { ...compilerOptions, ...parsed.compilerOptions }
    if (parsed.files !== undefined) files = parsed.files
    if (parsed.include !== undefined) include = parsed.include
    if (parsed.exclude !== undefined) exclude = parsed.exclude
    outputDirectories = { ...outputDirectories, ...parsed.outputDirectories }
  }
  if (config.files !== undefined) files = config.files.map(file => path.resolve(path.dirname(configPath), file))
  if (config.include !== undefined) include = config.include.map(pattern => path.resolve(path.dirname(configPath), pattern))
  if (config.exclude !== undefined) exclude = config.exclude.map(pattern => path.resolve(path.dirname(configPath), pattern))
  for (const option of ['outDir', 'declarationDir']) {
    if (config.compilerOptions?.[option]) outputDirectories[option] = path.resolve(path.dirname(configPath), config.compilerOptions[option])
  }
  return { config, compilerOptions: { ...compilerOptions, ...config.compilerOptions }, files, include, exclude, outputDirectories }
}

function collectSvelteDeclarations(directory) {
  if (!fs.existsSync(directory)) return []
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...collectSvelteDeclarations(filename))
    else if (entry.name.endsWith('.svelte.d.ts')) result.push(filename)
  }
  return result
}

/** Prepare an isolated native configuration while preserving the existing declaration contract. */
function prepareNativeConfig(projectFolder, workDirectory, options = {}) {
  const project = path.resolve(projectFolder)
  const originalPath = path.join(project, 'tsconfig.json')
  const original = readConfig(originalPath)
  if (!original.compilerOptions.rootDir) {
    throw new NativeValidationError('Native validation requires an explicit rootDir to preserve declaration paths')
  }
  if (original.compilerOptions.noEmit) {
    throw new NativeValidationError('The project disables declaration emit')
  }
  const compilerOptions = {
    strict: original.compilerOptions.strict ?? false,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: options.noEmit ?? false,
    incremental: true,
    tsBuildInfoFile: path.join(path.resolve(workDirectory), 'native.tsbuildinfo')
  }
  if (['node', 'node10'].includes(original.compilerOptions.moduleResolution)) {
    compilerOptions.moduleResolution = 'bundler'
  }
  if (options.declarationDir !== undefined) compilerOptions.declarationDir = path.resolve(options.declarationDir)
  const typesDirectory = path.join(project, 'types')
  if (fs.existsSync(typesDirectory)) {
    // Match compile.js: the legacy validator adds project-local generated types.
    compilerOptions.typeRoots = [
      ...(original.config.compilerOptions?.typeRoots ?? ['./node_modules/@types']).map(directory => path.resolve(project, directory)),
      typesDirectory
    ]
  }
  const config = {
    extends: originalPath,
    compilerOptions,
    include: original.include ?? (original.files === undefined ? [path.join(project, '**/*')] : [])
  }
  config.exclude = original.exclude ?? [
    ...['node_modules', 'bower_components', 'jspm_packages'].map(directory => path.join(project, directory)),
    ...Object.values(original.outputDirectories)
  ]
  const svelteDeclarations = collectSvelteDeclarations(typesDirectory)
  if (svelteDeclarations.length > 0) config.files = [...(original.files ?? []), ...svelteDeclarations]
  fs.mkdirSync(workDirectory, { recursive: true })
  const filename = path.join(path.resolve(workDirectory), 'tsconfig.native.json')
  fs.writeFileSync(filename, JSON.stringify(config, null, 2) + '\n')
  return filename
}

/** Resolve and verify the separately installed native compiler. */
function getNativeCompiler() {
  const packagePath = require.resolve('typescript-native/package.json')
  const compiler = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  if (compiler.version !== nativeValidation.compilerVersion) {
    throw new NativeValidationError(`Expected native TypeScript ${nativeValidation.compilerVersion}, found ${compiler.version}`)
  }
  return path.join(path.dirname(packagePath), 'bin/tsc')
}

/** Validate declarations using TypeScript 7, propagating every compiler failure. */
async function validateNative(projectFolder = process.cwd()) {
  const workDirectory = path.join(projectFolder, '.validate')
  const filename = prepareNativeConfig(projectFolder, workDirectory)
  const compiler = getNativeCompiler()
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [compiler, '--project', filename, '--pretty', 'false'], {
      cwd: projectFolder,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => reject(new NativeValidationError('Could not start native TypeScript', { cause: error })))
    child.on('close', (code, signal) => resolve({ stdout, stderr, code, signal }))
  })
  fs.writeFileSync(path.join(workDirectory, 'validate.log'), result.stdout)
  fs.writeFileSync(path.join(workDirectory, 'validate-err.log'), result.stderr)
  if (result.code !== 0) {
    throw new NativeValidationError(
      (result.stdout + result.stderr).trim() || `Native TypeScript exited with ${result.code ?? result.signal}`
    )
  }
}

module.exports = { getNativeCompiler, prepareNativeConfig, validateNative, NativeValidationError }
