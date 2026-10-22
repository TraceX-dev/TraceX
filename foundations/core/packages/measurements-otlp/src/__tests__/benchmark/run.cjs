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

// Run from measurements-otlp with an external Tinybench installation:
// npm install --prefix /tmp/tracex-measure-context-bench --no-save --ignore-scripts tinybench@2.9.0
// TINYBENCH_MODULE=/tmp/tracex-measure-context-bench/node_modules/tinybench node --expose-gc src/__tests__/benchmark/run.cjs
// Baseline snapshots preserve the old behavior; sync logging and inheritance are intentional changes.
// heapUsed after GC measures retained memory, not the total number of allocations.

/* eslint-disable @typescript-eslint/explicit-function-return-type -- This standalone JavaScript driver cannot declare TypeScript return types. */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { pathToFileURL } = require('node:url')
const coreRoot = path.resolve(__dirname, '../../../../measurements')
const coreRequire = Module.createRequire(path.join(coreRoot, 'package.json'))
const ts = Module.createRequire(coreRequire.resolve('ts-jest'))('typescript')

// Load current TypeScript sources in memory, without generating build artifacts.
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  return request === '@hcengineering/measurements'
    ? path.join(coreRoot, 'src/index.ts')
    : resolve.call(this, request, parent, ...rest)
}
// eslint-disable-next-line n/no-deprecated-api -- Test-only source loading avoids generating or replacing package artifacts.
require.extensions['.ts'] = (mod, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ESNext, esModuleInterop: true }
  })
  mod._compile(result.outputText, filename)
}

const { MeasureMetricsContext, newMetrics, noParamsLogger } = coreRequire('./src/index.ts')
const { MeasureMetricsContext: OldCore } = coreRequire('./src/__tests__/baseline/context.ts')
const { OpenTelemetryMetricsContext } = require('../../telemetry.ts')
const { OpenTelemetryMetricsContext: OldOTel } = require('../baseline/telemetry.ts')
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node')
const { context, trace } = require('@opentelemetry/api')
const provider = new NodeTracerProvider()
provider.register()
const tracer = provider.getTracer('context-benchmark')
const factories = {
  core: () => new MeasureMetricsContext('root', { service: 'bench' }, undefined, newMetrics(), noParamsLogger),
  oldCore: () => new OldCore('root', { service: 'bench' }, undefined, newMetrics(), noParamsLogger),
  otel: () => new OpenTelemetryMetricsContext('root', tracer, undefined, undefined, { service: 'bench' }, undefined, newMetrics(), noParamsLogger),
  oldOTel: () => new OldOTel('root', tracer, undefined, undefined, { service: 'bench' }, undefined, newMetrics(), noParamsLogger)
}
const payload = JSON.stringify({ values: Array.from({ length: 24 }, (_, i) => i), label: 'useful work at each level' })
const params = Object.freeze({ method: 'GET', worker: 'A' })
let checksum = 0
function work () {
  const value = JSON.parse(payload)
  checksum += JSON.stringify({ sum: value.values.reduce((sum, item) => sum + item, 0), label: value.label }).length
}

function execution (root, mode, count, depth, opt) {
  function sync (ctx, level) {
    const operation = (child) => {
      work()
      if (level + 1 < depth) sync(child, level + 1)
    }
    if (mode === 'withSync') ctx.withSync('level' + level, params, operation, undefined, opt)
    else void ctx.with('level' + level, params, operation, undefined, opt)
  }
  async function asynchronous (ctx, level) {
    await ctx.with('level' + level, params, async (child) => {
      work()
      if (level + 1 < depth) await asynchronous(child, level + 1)
    }, undefined, opt)
  }
  if (mode === 'with-async') {
    return (async () => { for (let i = 0; i < count; i++) await asynchronous(root, 0) })()
  }
  for (let i = 0; i < count; i++) sync(root, 0)
}

function rawExecution (mode, count, depth) {
  function sync (level) {
    work()
    if (level + 1 < depth) sync(level + 1)
  }
  async function asynchronous (level) {
    work()
    if (level + 1 < depth) await asynchronous(level + 1)
  }
  if (mode === 'with-async') {
    return (async () => { for (let i = 0; i < count; i++) await asynchronous(0) })()
  }
  for (let i = 0; i < count; i++) sync(0)
}

async function main () {
  assert.equal(typeof global.gc, 'function', 'Run Node with --expose-gc')
  const { Bench } = await import(pathToFileURL(require.resolve(process.env.TINYBENCH_MODULE ?? 'tinybench')).href)
  const report = { node: process.version, filter: process.env.METRICS_BENCHMARK_FILTER ?? null, samples: 7, checksum: 0, timing: [], memory: [] }
  const shapes = [
    ...[1000, 5000, 10000].map((count) => ({ count, depth: 1 })),
    ...[100, 500, 1000].map((count) => ({ count, depth: 10 }))
  ]
  for (const [implementation, baseline] of [['core', 'oldCore'], ['otel', 'oldOTel']]) {
    if (process.env.METRICS_BENCHMARK_MEMORY_ONLY === '1') continue
    for (const mode of ['with-sync', 'with-async', 'withSync']) {
      for (const span of [false, true]) {
        for (const log of [false, true]) {
          for (const inheritParams of [false, true]) {
            const opt = Object.freeze({ span, log, inheritParams })
            for (const { count, depth } of shapes) {
              const key = `${implementation}/${mode}/${span}/${log}/${inheritParams}/${count}/${depth}`
              if (report.filter !== null && !key.includes(report.filter)) continue
              const roots = { before: factories[baseline](), after: factories[implementation]() }
              const bench = new Bench({ time: 0, iterations: 7, warmupTime: 0, warmupIterations: 1 })
              bench.add('raw', () => rawExecution(mode, count, depth))
              // Reverse task order for alternating shapes to reduce ordering bias.
              for (const name of count === 500 || count === 5000 ? ['after', 'before'] : ['before', 'after']) {
                bench.add(name, () => execution(roots[name], mode, count, depth, opt))
              }
              await bench.warmup()
              await bench.run()
              const samplesByTask = {}
              const times = Object.fromEntries(bench.tasks.map((task) => {
                if (task.result.error) throw task.result.error
                const samples = [...task.result.samples].sort((a, b) => a - b)
                samplesByTask[task.name] = samples
                return [task.name, samples[Math.floor(samples.length / 2)]]
              }))
              for (const root of Object.values(roots)) {
                assert.ok(root.metrics.measurements.level0.operations >= count)
              }
              const rawMs = times.raw
              report.timing.push({ implementation, mode, span, log, inheritParams, count, depth,
                beforeMs: times.before, afterMs: times.after, rawMs, samplesMs: samplesByTask,
                relativeToBefore: times.after / times.before, relativeToRaw: times.after / rawMs })
            }
          }
        }
      }
    }
    console.log(`Timing complete: ${implementation}`)
  }
  for (const [implementation, factory] of Object.entries(factories)) {
    if (process.env.METRICS_BENCHMARK_SKIP_MEMORY === '1') continue
    const root = factory()
    const opt = Object.freeze({ span: false })
    void execution(root, 'withSync', 10000, 1, opt)
    global.gc()
    const before = process.memoryUsage().heapUsed
    void execution(root, 'withSync', 1000000, 1, opt)
    const beforeGC = process.memoryUsage().heapUsed
    global.gc()
    const after = process.memoryUsage().heapUsed
    assert.equal(root.metrics.measurements.level0.operations, 1010000)
    assert.ok(after - before < 1024 * 1024, 'Retained heap grew by more than 1 MiB with bounded parameters')
    report.memory.push({ implementation, operations: 1000000,
      retainedBytes: after - before, retainedLimitBytes: 1024 * 1024, heapBeforeGCBytes: beforeGC - before,
      sampleEntries: root.metrics.measurements.level0.topResult.length })
  }
  report.checksum = checksum
  const target = process.env.METRICS_BENCHMARK_REPORT ?? '/tmp/measure-context-benchmark.json'
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n')
  console.log(`Report: ${target}`)
  const worst = [...report.timing].sort((a, b) => b.relativeToRaw - a.relativeToRaw)[0]
  if (worst === undefined) return
  console.log(`Worst raw ratio: ${worst.relativeToRaw.toFixed(2)}x`)
  // Preserve measurements even if a regression violates the agreed workload threshold.
  assert.ok(worst.relativeToRaw <= 5, 'Measured workload exceeds the 5x raw execution threshold')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  await provider.shutdown()
  context.disable()
  trace.disable()
})
