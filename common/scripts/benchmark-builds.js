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

const { spawn, execFile } = require('node:child_process')
const { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } = require('node:fs')
const { availableParallelism } = require('node:os')
const { resolve, join } = require('node:path')
const { performance } = require('node:perf_hooks')
const { parseArgs, promisify } = require('node:util')

const root = resolve(__dirname, '../..')
const execFileAsync = promisify(execFile)
let activeChild
let interrupted = false

function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

process.on('SIGINT', () => {
  interrupted = true
  if (activeChild !== undefined) signalGroup(activeChild, 'SIGINT')
})
process.on('SIGTERM', () => {
  interrupted = true
  if (activeChild !== undefined) signalGroup(activeChild, 'SIGTERM')
})

/** Verify Rush metadata before starting any timed commands. */
async function checkPreparation() {
  const options = { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 30000 }
  const git = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], options)
  if (git.stdout.trim() !== 'true') throw new Error('Run the benchmark in a Git working tree')
  const listed = await execFileAsync('rush', ['list', '--json'], options)
  const { projects } = JSON.parse(listed.stdout)
  if (!Array.isArray(projects) || projects.length === 0) throw new Error('rush list returned no projects')
  const missing = projects.filter((project) => !existsSync(join(root, project.path, '.rush/temp/shrinkwrap-deps.json')))
  if (missing.length > 0) {
    throw new Error(
      `Rush dependency metadata is missing for ${missing.length} projects (${missing.slice(0, 3).map((project) => project.path).join(', ')}). ` +
      'Run rush install, then rerun the benchmark. No builds have been started.'
    )
  }
  console.log(`Preparation OK: Git working tree, Rush metadata present for ${projects.length} projects`)
}

/** Measure wall time, stopping development servers after their initial compilation. */
async function measure(command, args, options) {
  if (interrupted) throw new Error('Benchmark interrupted')
  console.log(`${options.label}: ${command} ${args.join(' ')}`)
  writeFileSync(options.log, '')
  const started = performance.now()

  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...options.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    activeChild = child
    let elapsed
    let failure
    let shutdownTimer
    let output = ''
    let stopping = false

    function stop() {
      if (stopping) return
      stopping = true
      signalGroup(child, 'SIGINT')
      shutdownTimer = setTimeout(() => {
        failure = new Error(`Graceful shutdown timed out; see ${options.log}`)
        signalGroup(child, 'SIGKILL')
      }, 30000)
    }

    const timeout = setTimeout(() => {
      failure = new Error(`Run exceeded 30 minutes; see ${options.log}`)
      stop()
    }, 30 * 60 * 1000)

    function onOutput(chunk) {
      appendFileSync(options.log, chunk)
      if (!options.server || stopping) return
      output += chunk.replace(/\u001b\[[0-9;]*m/g, '')
      if (/\bcompiled with[^\n]*\berrors?\b|(?:^|\n)ERROR in\b|\[TraceX benchmark\] initial compilation failed/.test(output)) {
        failure = new Error(`Frontend compilation failed; see ${options.log}`)
        stop()
        return
      }
      const completed = output.match(
        /\bwebpack(?:\s+\d+(?:\.\d+)*(?:-[\w.]+)?)?\s+compiled (?:successfully|with \d+ warnings?)\b/g
      ) ?? []
      // dev/prod/webpack.config.js exports two compiler configurations.
      const ready = options.server === 'rsbuild'
        ? output.includes('[TraceX benchmark] initial compilation completed')
        : completed.length >= 2
      if (ready) {
        elapsed = performance.now() - started
        stop()
      }
    }

    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8')
      stream.on('data', onOutput)
    }
    child.on('error', (error) => {
      failure = error
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      clearTimeout(shutdownTimer)
      activeChild = undefined
      if (interrupted) {
        rejectRun(new Error('Benchmark interrupted'))
      } else if (failure !== undefined) {
        rejectRun(failure)
      } else if (options.server && elapsed === undefined) {
        rejectRun(new Error(`Server exited before initial compilation finished (${code ?? signal}); see ${options.log}`))
      } else if (!options.server && code !== 0) {
        const tail = readFileSync(options.log, 'utf8').split('\n').slice(-20).join('\n')
        rejectRun(new Error(`Command failed (${code ?? signal}); see ${options.log}\n${tail}`))
      } else {
        const seconds = (elapsed ?? performance.now() - started) / 1000
        console.log(`  ${seconds.toFixed(3)} s${options.server ? ' to initial compilation' : ''}`)
        resolveRun(seconds)
      }
    })
  })
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

async function main() {
  const { values } = parseArgs({
    options: {
      runs: { type: 'string', default: '3' },
      parallelism: { type: 'string', default: '10' },
      frontend: { type: 'string', default: 'both' },
      'only-frontends': { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false }
    }
  })
  if (values.help) {
    console.log('Usage: node common/scripts/benchmark-builds.js [--runs 3] [--parallelism 10] [--frontend webpack|rsbuild|both] [--only-frontends] [--check]')
    console.log('Runs task-runner and frontend benchmarks plus unmeasured cache warmups. Requires macOS or Linux.')
    console.log('Stop other development servers first. Logs and results are saved under .build/benchmarks/.')
    console.log('--check verifies installation metadata without starting any builds.')
    console.log('--only-frontends skips Rush builds and measures only the selected frontend servers.')
    return
  }
  if (process.platform === 'win32') throw new Error('This benchmark requires POSIX process groups (macOS or Linux)')
  const runs = Number(values.runs)
  const requestedParallelism = Number(values.parallelism)
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer')
  if (!Number.isSafeInteger(requestedParallelism) || requestedParallelism < 1) {
    throw new Error('--parallelism must be a positive integer')
  }
  if (!['webpack', 'rsbuild', 'both'].includes(values.frontend)) {
    throw new Error('--frontend must be webpack, rsbuild, or both')
  }
  await checkPreparation()
  const parallelism = Math.min(requestedParallelism, availableParallelism())
  console.log(`Using parallelism ${parallelism} for Rush (requested ${requestedParallelism})`)
  if (values.check) return

  const directory = join(root, '.build/benchmarks', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(directory, { recursive: true })
  const rushArgs = ['--parallelism', String(parallelism)]
  const frontends = values.frontend === 'both' ? ['webpack', 'rsbuild'] : [values.frontend]
  const results = values['only-frontends'] ? {} : {
    'Rush / cache disabled': [],
    'Rush / warm unchanged run': []
  }
  for (const frontend of frontends) {
    results[`${frontend} dev-server / filesystem cache disabled`] = []
    results[`${frontend} dev-server / warm filesystem cache`] = []
  }

  function saveResults() {
    writeFileSync(join(directory, 'results.json'), JSON.stringify({ runs, requestedParallelism, parallelism, frontends, results }, null, 2) + '\n')
  }

  async function run(label, command, args, sample, options = {}) {
    return await measure(command, args, {
      label,
      log: join(directory, `${sample}-${label.replace(/[^a-zA-Z0-9]+/g, '-')}.log`),
      ...options
    })
  }

  for (let sample = 1; sample <= runs; sample++) {
    console.log(`\nSample ${sample}/${runs}`)
    if (!values['only-frontends']) {
      results['Rush / cache disabled'].push(
        await run('Rush uncached', 'rush', ['rebuild', ...rushArgs], sample, {
          env: { RUSH_BUILD_CACHE_ENABLED: '0' }
        })
      )
      saveResults()
      await run('Rush warmup (unmeasured)', 'rush', ['build', ...rushArgs], sample, {
        env: { RUSH_BUILD_CACHE_ENABLED: '1' }
      })
      results['Rush / warm unchanged run'].push(
        await run('Rush cached', 'rush', ['build', ...rushArgs], sample, {
          env: { RUSH_BUILD_CACHE_ENABLED: '1' }
        })
      )
      saveResults()
    }
    for (const frontend of sample % 2 === 1 ? frontends : [...frontends].reverse()) {
      const serverOptions = {
        cwd: join(root, 'dev/prod'),
        server: frontend,
        env: { TRACEX_BENCHMARK: 'true' }
      }
      const suffix = frontend === 'webpack' ? ':webpack' : ''
      const statsArgs = frontend === 'webpack' ? ['--stats=errors-warnings'] : []
      results[`${frontend} dev-server / filesystem cache disabled`].push(
        await run(`${frontend} dev-server uncached`, 'rushx', [`dev-server${suffix}`, ...statsArgs], sample, serverOptions)
      )
      saveResults()
      await run(`${frontend} dev-server warmup (unmeasured)`, 'rushx', [`dev-server-cache${suffix}`, ...statsArgs], sample, serverOptions)
      results[`${frontend} dev-server / warm filesystem cache`].push(
        await run(`${frontend} dev-server cached`, 'rushx', [`dev-server-cache${suffix}`, ...statsArgs], sample, serverOptions)
      )
      saveResults()
    }
  }

  console.table(Object.entries(results).map(([scenario, samples]) => ({
    scenario,
    'median (s)': median(samples).toFixed(3),
    'samples (s)': samples.map((seconds) => seconds.toFixed(3)).join(', ')
  })))
  console.log(`Logs and raw results: ${directory}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = interrupted ? 130 : 1
})
